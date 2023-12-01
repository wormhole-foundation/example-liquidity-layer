import {
    CHAIN_ID_AVAX,
    coalesceChainName,
    ChainId,
    parseVaa,
    keccak256,
} from "@certusone/wormhole-sdk";
import { SIGNERS, CCTP_EMITTER_ADDRESSES } from "./helpers/consts";
import { TypedEvent } from "../ts/src/types/common";
import { EvmMatchingEngine, IERC20__factory, RedeemParameters } from "../ts/src/";
import { ethers } from "ethers";
import {
    wormholeContract,
    getChainId,
    parseRelevantPayload,
    sleep,
    auctionStillOpen,
    getSignedVaa,
    handleCircleMessageInLogs,
    getCctpEmitterFromConfig,
} from "./helpers/utils";
import { getRelayerConfig } from "./helpers/config";

// Load relayer config.
const config = getRelayerConfig();

// Create Matching Engine Instance.
const engine = new EvmMatchingEngine(SIGNERS[CHAIN_ID_AVAX], config.matchingEngineAddress);
const signer = engine.signer;

function usdc() {
    return IERC20__factory.connect(config.usdc, signer);
}

async function handleNewFastTransfer(
    signerAddress: string,
    auctionId: Buffer,
    vaa: Uint8Array,
    parsed: any
): Promise<[boolean, ethers.BigNumber]> {
    const auctionInfo = await engine.liveAuctionInfo(auctionId);

    // Fetch relevant transfer info.
    const amount = ethers.BigNumber.from(parsed.body.fastMarketOrder.amountIn);
    const maxFee = ethers.BigNumber.from(parsed.body.fastMarketOrder.maxFee);
    const amountToPlay = amount.add(maxFee);

    let participated = false;
    if (auctionInfo.status == 0) {
        // Fetch token balance so we know if we can participate.
        const balance = await usdc().balanceOf(signerAddress);

        if (!balance.gte(amountToPlay)) {
            throw Error("Insufficient balance to participate in auction.");
        }

        // Always place a bid for the maxFee, since we are starting the auction ($$$).
        // This is where the fair value should be computed and used once there is a
        // competitive market.
        const reciept = await engine.placeInitialBid(vaa, maxFee).then((tx) => tx.wait(1));
        console.log(`Started auction, tx hash: ${reciept.transactionHash}`);

        participated = true;
    } else if (auctionInfo.status == 1) {
        // Improve our bid if someone beat us to the punch.
        const isOpen = await auctionStillOpen(auctionId, engine);
        if (!isOpen) {
            participated = false;
        } else {
            participated = await improveBid(auctionId, vaa, signerAddress, amountToPlay);
        }
    }

    return [participated, amountToPlay];
}

async function improveBid(
    auctionId: Buffer,
    vaa: Uint8Array,
    signerAddress: string,
    amountToPlay: ethers.BigNumber
): Promise<boolean> {
    // Need to fetch fresh auction info since it may have changed.
    const auctionInfo = await engine.liveAuctionInfo(auctionId);

    let bidImproved = false;
    if (auctionInfo.highestBidder != signerAddress) {
        const balance = await usdc().balanceOf(signerAddress);
        if (!balance.gte(amountToPlay)) {
            return false;
        }

        // For the sake of this example, we are not going to do anything fancy to
        // compute our new bid, we are just going to carp the current bid by one.
        const newBid = ethers.BigNumber.from(auctionInfo.bidPrice).sub(1);
        try {
            const reciept = await engine.improveBid(vaa, newBid).then((tx) => tx.wait());
            console.log(`Improved bid, tx hash: ${reciept.transactionHash}`);
            bidImproved = true;
        } catch (e) {
            console.error(e);
        }
    }

    return bidImproved;
}

async function handleExecuteFastTransfer(auctionId: Buffer, vaa: Uint8Array): Promise<boolean> {
    // Fetch auction info.
    const auctionInfo = await engine.liveAuctionInfo(auctionId);

    // Check if we are the highest bidder.
    const signerAddress = await signer.getAddress();
    if (auctionInfo.highestBidder != signerAddress) {
        return false;
    }

    // Execute the fast transfer. This loop is pretty disgusting, but it's fine for
    // this example. In reality, we should parse the error message and handle
    // the error accordingly.
    let counter = 0;
    let error;
    while (counter < 5) {
        try {
            const reciept = await engine.executeFastOrder(vaa).then((tx) => tx.wait());
            console.log(`Executed fast transfer, tx hash: ${reciept.transactionHash}`);
            return true;
        } catch (e) {
            console.log("Failed to execute fast transfer. Trying again...");
            error = e;
        }

        // sleep 1 second.
        await sleep(1000);
        counter += 1;
    }

    console.log(error);
    return false;
}

async function onFastTransfer(parsed: any, vaa: Uint8Array): Promise<boolean> {
    // Keccak the hash again, since parseVaa only does this once.
    const parsedVaa = parseVaa(vaa);
    const auctionId = keccak256(parsedVaa.hash);
    const signerAddress = await signer.getAddress();

    // Handle new fast transfer Vaas. This will either start a new auction
    // or improve our bid if we are not the highest bidder (auction is open).
    const [participated, amountToPlay] = await handleNewFastTransfer(
        signerAddress,
        auctionId,
        vaa,
        parsed
    );
    if (!participated) {
        console.log(
            `Ignoring fast transfer VAA: ${auctionId.toString()}, sequence: ${parsedVaa.sequence.toString()}`
        );
    }

    // If we got here, this means we participated in an auction. We need to loop on a timer to
    // either improve the bid or execute the fast transfer.
    let orderExecuted = false;
    while (true) {
        const isOpen = await auctionStillOpen(auctionId, engine);
        if (isOpen) {
            await improveBid(auctionId, vaa, signerAddress, amountToPlay);
        } else {
            orderExecuted = await handleExecuteFastTransfer(auctionId, vaa);
            break;
        }
        await sleep(500);
    }

    return orderExecuted;
}

async function handleSlowOrderResponse(
    receipt: ethers.ContractReceipt,
    circleEmitterAddress: string,
    vaa: Uint8Array,
    fastVaa: Uint8Array
) {
    try {
        console.log("Fetching circle message and attestation");
        const [circleBridgeMessage, circleAttestation] = await handleCircleMessageInLogs(
            receipt.logs!,
            circleEmitterAddress
        );

        // Verify params.
        if (circleBridgeMessage === null || circleAttestation === null) {
            throw new Error(`Error parsing receipt, txhash: ${receipt.transactionHash}`);
        }

        // redeem parameters for target function call
        const slowOrderResponse: RedeemParameters = {
            encodedWormholeMessage: vaa,
            circleBridgeMessage: circleBridgeMessage,
            circleAttestation: circleAttestation,
        };

        const redeemReceipt = await engine
            .executeSlowOrderAndRedeem(fastVaa, slowOrderResponse)
            .then((tx) => tx.wait());
        console.log(`Executed slow order, tx hash: ${redeemReceipt.transactionHash}`);
    } catch (e) {
        throw Error(`Failed to execute slow order response: ${e}`);
    }
}

function handleRelayerEvent(
    _sender: string,
    sequence: ethers.BigNumber,
    _nonce: number,
    payload: string,
    _consistencyLevel: number,
    typedEvent: TypedEvent<
        [string, ethers.BigNumber, number, string, number] & {
            sender: string;
            sequence: ethers.BigNumber;
            nonce: number;
            payload: string;
            consistencyLevel: number;
        }
    >
) {
    (async () => {
        try {
            // create payload buffer
            const payloadArray = Buffer.from(ethers.utils.arrayify(payload));

            // Parse the message payload if it's relevant (fast market order).
            const parsedPayload = parseRelevantPayload(config, _sender, payloadArray);
            const fromChain = getChainId(config, _sender)!;

            // Ignore empty payloads.
            if (parsedPayload === null) {
                return;
            }

            console.log(
                `Fetching Fast Transfer VAA, sequence: ${sequence.toString()}, from chain: ${fromChain}`
            );
            const fastVaaBytes = await getSignedVaa(fromChain, _sender, sequence);

            // Handle fast transfer VAAs.
            if (parsedPayload.body.hasOwnProperty("fastMarketOrder")) {
                const orderExecuted = await onFastTransfer(parsedPayload, fastVaaBytes);

                if (orderExecuted) {
                    const slowSequence = parsedPayload.body.fastMarketOrder!.slowSequence;

                    // Fetch the associated slow order response.
                    console.log(`Fetching order response, sequence: ${slowSequence.toString()}`);
                    const slowVaaBytes = await getSignedVaa(
                        fromChain,
                        getCctpEmitterFromConfig(config, fromChain)!,
                        slowSequence
                    );
                    console.log("Order response VAA found");

                    // We need the receipt to fetch the Circle message.
                    const receipt = await typedEvent.getTransactionReceipt();

                    // Execute the slow order.
                    await handleSlowOrderResponse(
                        receipt,
                        CCTP_EMITTER_ADDRESSES[fromChain],
                        slowVaaBytes,
                        fastVaaBytes
                    );
                }
            }
        } catch (e) {
            console.error(e);
        }
    })();
}

function subscribeToEvents(
    wormhole: ethers.Contract,
    chainId: ChainId,
    fastTransferSender: string
) {
    const chainName = coalesceChainName(chainId);
    if (!wormhole.address) {
        console.error("No known core contract for chain", chainName);
        process.exit(1);
    }

    // Subscribe to fast orders.
    wormhole.on(
        wormhole.filters.LogMessagePublished(ethers.utils.getAddress(fastTransferSender)),
        handleRelayerEvent
    );
    console.log(
        `Subscribed to: ${chainName}, core contract: ${wormhole.address}, sender: ${fastTransferSender}`
    );
}

async function main() {
    // Approve the engine to spend unlimited tokens.
    usdc()
        .approve(
            engine.address,
            ethers.BigNumber.from(
                "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            )
        )
        .then((tx) => tx.wait());

    // Subscribe.
    for (const router of config.routers) {
        try {
            subscribeToEvents(
                wormholeContract(router.wormhole, SIGNERS[router.chain]),
                router.chain,
                router.router
            );
        } catch (e: any) {
            console.log(e);
        }
    }
}

// start the process
main();
