import { expect } from "chai";
import { ethers } from "ethers";
import {
    EvmMatchingEngine,
    EvmTokenRouter,
    MessageDecoder,
    OrderResponse,
    decodedOrderResponse,
    errorDecoder,
} from "../src";
import {
    CircleAttester,
    GuardianNetwork,
    LOCALHOSTS,
    MATCHING_ENGINE_CHAIN,
    MATCHING_ENGINE_NAME,
    ScoreKeeper,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    asUniversalBytes,
    burnAllUsdc,
    getSdkSigner,
    getSigners,
    mine,
    mineToGracePeriod,
    mineToPenaltyPeriod,
    mineWait,
    mintNativeUsdc,
    parseLiquidityLayerEnvFile,
    signSendMineWait,
    signSendOnly,
    sleep,
    toContractAddresses,
} from "../src/testing";
import { IERC20__factory } from "../src/types";

import {
    FastTransfer,
    TokenRouter,
    payloadIds,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { encoding } from "@wormhole-foundation/sdk-base";
import {
    CircleBridge,
    VAA,
    deserialize,
    keccak256,
    serialize,
    toUniversal,
} from "@wormhole-foundation/sdk-definitions";

// Cannot send a fast market order from the matching engine chain.
const CHAIN_PATHWAYS: ValidNetwork[][] = [
    ["Base", "Ethereum"],
    ["Ethereum", "Base"],
    ["Base", "Avalanche"],
    ["Ethereum", "Avalanche"],
];

const TEST_AMOUNT = ethers.parseUnits("1000", 6);
const FEE_AMOUNT = BigInt(ethers.parseUnits("10", 6).toString());

describe("Fast Market Order Business Logic -- CCTP to CCTP", function (this: Mocha.Suite) {
    const envPath = `${__dirname}/../../env/localnet`;

    const guardianNetwork = new GuardianNetwork();
    const circleAttester = new CircleAttester();

    // Matching Engine configuration.
    const engineProvider = new ethers.JsonRpcProvider(LOCALHOSTS[MATCHING_ENGINE_NAME]);
    const engineWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[2], engineProvider);
    const engineEnv = parseLiquidityLayerEnvFile(`${envPath}/${MATCHING_ENGINE_NAME}.env`);

    const engine = (() => {
        if (engineEnv.chainType !== "Evm") throw new Error("Unsupported chain");
        return new EvmMatchingEngine(
            "Devnet",
            MATCHING_ENGINE_NAME,
            engineProvider,
            toContractAddresses(engineEnv),
        );
    })();

    // Auction participants.
    const { wallet: initialBidder, signer: initialBidderSigner } = getSigners(
        WALLET_PRIVATE_KEYS[3],
        engineProvider,
    );
    const { wallet: bidderTwo } = getSigners(WALLET_PRIVATE_KEYS[4], engineProvider);
    const { wallet: bidderThree } = getSigners(WALLET_PRIVATE_KEYS[5], engineProvider);
    const { wallet: highestBidder, signer: highestBidderSigner } = getSigners(
        WALLET_PRIVATE_KEYS[6],
        engineProvider,
    );
    const { wallet: liquidator } = getSigners(WALLET_PRIVATE_KEYS[7], engineProvider);

    for (const [fromChainName, toChainName] of CHAIN_PATHWAYS) {
        const localVariables = new Map<string, any>();

        describe(`${fromChainName} <> ${toChainName}`, () => {
            // From setup.
            const fromProvider = new ethers.JsonRpcProvider(LOCALHOSTS[fromChainName]);
            const { wallet: fromWallet, signer: fromSigner } = getSigners(
                WALLET_PRIVATE_KEYS[0],
                fromProvider,
            );

            const fromEnv = parseLiquidityLayerEnvFile(`${envPath}/${fromChainName}.env`);
            const fromTokenRouter = (() => {
                if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                return new EvmTokenRouter(
                    "Devnet",
                    fromChainName,
                    fromProvider,
                    toContractAddresses(fromEnv),
                );
            })();

            // To setup.
            const toProvider = new ethers.JsonRpcProvider(LOCALHOSTS[toChainName]);
            const { wallet: toWallet, signer: toSigner } = getSigners(
                WALLET_PRIVATE_KEYS[1],
                toProvider,
            );

            const toEnv = parseLiquidityLayerEnvFile(`${envPath}/${toChainName}.env`);
            const toTokenRouter = (() => {
                if (toEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                return new EvmTokenRouter(
                    "Devnet",
                    toChainName,
                    toProvider,
                    toContractAddresses(toEnv),
                );
            })();

            describe(`Successful Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT,
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                        return await IERC20__factory.connect(
                            fromEnv.tokenAddress,
                            fromWallet,
                        ).balanceOf(fromWallet.address);
                    })();
                    localVariables.set("amountIn", amountIn);

                    const order: TokenRouter.OrderRequest = {
                        amountIn,
                        minAmountOut: BigInt(0),
                        deadline: 0,
                        maxFee: FEE_AMOUNT,
                        targetChain: toChainName,
                        redeemer: toUniversal(toChainName, toWallet.address),
                        redeemerMessage: encoding.bytes.encode("All your base are belong to us."),
                        refundAddress: toUniversal(fromChainName, fromWallet.address),
                    };

                    const txs = fromTokenRouter.placeFastMarketOrder(fromWallet.address, order);
                    const receipt = await signSendMineWait(txs, fromSigner);
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt!.hash,
                    );

                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(fromEnv.tokenRouterAddress),
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse",
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt!,
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set(
                        "fastVaa",
                        deserialize("FastTransfer:FastMarketOrder", fastVaa),
                    );
                });

                it(`Matching Engine -- Start Fast Order Auction`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;

                    const auctionId = FastTransfer.auctionId(fastVaa);
                    localVariables.set("auctionId", auctionId);

                    const fastOrder = fastVaa.payload;

                    // Security deposit amount of the initial bid.
                    const initialDeposit = fastOrder.amountIn + fastOrder.maxFee;

                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(
                        engineEnv.tokenAddress,
                        initialBidder.provider!,
                    );

                    const initialBidderAddress = await initialBidder.getAddress();
                    await mintNativeUsdc(usdc, initialBidderAddress, initialDeposit);

                    const balanceBefore = await usdc.balanceOf(initialBidderAddress);

                    const txs = engine.placeInitialOffer(
                        initialBidderAddress,
                        fastVaa,
                        fastOrder.maxFee,
                        initialDeposit,
                    );
                    const receipt = await signSendMineWait(txs, initialBidderSigner);

                    const balanceAfter = await usdc.balanceOf(initialBidderAddress);
                    expect((balanceBefore - balanceAfter).toString()).to.eql(
                        initialDeposit.toString(),
                    );

                    // Validate state changes.
                    const auctionData = await engine.liveAuctionInfo(auctionId);

                    expect(auctionData.status).to.eql(1n);
                    expect(auctionData.startBlock.toString()).to.eql(
                        receipt!.blockNumber.toString(),
                    );
                    expect(auctionData.highestBidder).to.eql(initialBidderAddress);
                    expect(auctionData.initialBidder).to.eql(initialBidderAddress);
                    expect(auctionData.amount.toString()).to.eql(fastOrder.amountIn.toString());
                    expect(auctionData.securityDeposit.toString()).to.eql(
                        fastOrder.maxFee.toString(),
                    );
                    expect(auctionData.bidPrice.toString()).to.eql(fastOrder.maxFee.toString());
                });

                it(`Matching Engine -- Fast Order Auction Period`, async () => {
                    const vaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    const auctionInfoBefore = await engine.liveAuctionInfo(auctionId);
                    const startingBid = auctionInfoBefore.bidPrice;
                    const initialDeposit =
                        auctionInfoBefore.amount + auctionInfoBefore.securityDeposit;

                    expect(startingBid > 0n && initialDeposit > 0n).is.true;

                    // Create array of test bids. This structure should not change, otherwise
                    // the following tests will fail.
                    const bids: ScoreKeeper[] = [
                        {
                            player: bidderTwo,
                            bid: startingBid - 1n,
                            balance: 0n,
                        },
                        {
                            player: bidderThree,
                            bid: startingBid / 2n,
                            balance: 0n,
                        },
                        {
                            player: highestBidder,
                            bid: startingBid / 3n,
                            balance: 0n,
                        },
                    ];

                    // Loop through and make multiple bids in the same block.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const playerAddress = await player.getAddress();
                        const playerSigner = getSdkSigner(fromChainName, player);

                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        await mintNativeUsdc(usdc, playerAddress, initialDeposit, false);

                        bids[i].balance = await usdc.balanceOf(playerAddress);

                        await sleep(1);

                        const txs = engine.improveOffer(playerAddress, vaa, bids[i].bid);
                        await signSendOnly(txs, playerSigner);
                    }

                    // Mine the block.
                    await mine(engineProvider);

                    // Validate balance changes. The lowest bid should have zero balance, the others
                    // should've been refunded.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const playerAddress = await player.getAddress();
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        const balanceAfter = await usdc.balanceOf(playerAddress);

                        if (i == 2) {
                            expect((balanceAfter - bids[i].balance).toString()).to.eql("0");
                        } else {
                            expect(balanceAfter.toString()).to.eql(
                                (bids[i].balance + initialDeposit).toString(),
                            );
                        }
                    }

                    // Validate state changes.
                    const auctionInfoAfter = await engine.liveAuctionInfo(auctionId);

                    expect(auctionInfoAfter.status).to.eql(1n);
                    expect(auctionInfoAfter.startBlock.toString()).to.eql(
                        auctionInfoBefore.startBlock.toString(),
                    );
                    expect(auctionInfoAfter.highestBidder).to.eql(await highestBidder.getAddress());
                    expect(auctionInfoAfter.initialBidder).to.eql(auctionInfoBefore.initialBidder);
                    expect(auctionInfoAfter.amount.toString()).to.eql(
                        auctionInfoBefore.amount.toString(),
                    );
                    expect(auctionInfoAfter.securityDeposit.toString()).to.eql(
                        auctionInfoBefore.securityDeposit.toString(),
                    );
                    expect(auctionInfoAfter.bidPrice.toString()).to.eql(bids[2].bid.toString());
                });

                it(`Matching Engine -- Execute Fast Order Within Grace Period`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;

                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    await mineToGracePeriod(auctionId, engine, engineProvider);

                    const highestBidderAddress = await highestBidder.getAddress();

                    // Fetch the initial bidder so we can do a balance check.
                    const auctionInfo = await engine.liveAuctionInfo(auctionId);

                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const balanceBefore = await usdc.balanceOf(highestBidderAddress);
                    const initialBidderBefore = await usdc.balanceOf(auctionInfo.initialBidder);

                    const txs = engine.executeFastOrder(highestBidderAddress, fastVaa);
                    const receipt = await signSendMineWait(txs, highestBidderSigner);

                    const transactionResult = await engine.getTransactionResults(receipt!.hash);

                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(engine.address),
                    );
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Validate state and balance changes.
                    const balanceAfter = await usdc.balanceOf(await highestBidder.getAddress());
                    const initialBidderAfter = await usdc.balanceOf(auctionInfo.initialBidder);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();

                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (auctionInfo.bidPrice + auctionInfo.securityDeposit).toString(),
                    );
                    expect(initialBidderAfter - initialBidderBefore).to.eql(initAuctionFee);

                    // Auction status should be complete (2).
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2n);

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt!,
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    localVariables.set("fastOrderResponse", orderResponse);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    expect(localVariables.delete("fastOrderResponse")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const { vaa, cctp } = decodedOrderResponse(orderResponse);
                    const txs = toTokenRouter.redeemFill(toWallet.address, vaa, cctp);
                    await signSendMineWait(txs, toSigner);

                    // Validate balance changes.
                    const { bidPrice, amount } = await engine.liveAuctionInfo(auctionId);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (amount - bidPrice - initAuctionFee).toString(),
                    );
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;
                    expect(localVariables.delete("auctionId")).is.true;

                    // Fetch balance of player four since they were the highest bidder.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const balanceBefore = await usdc.balanceOf(highestBidder.address);
                    const expectedAmount = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.amount);

                    const cctpVaa = deserialize(
                        "FastTransfer:CctpDeposit",
                        params.encodedWormholeMessage,
                    );
                    const cctp = {
                        message: CircleBridge.deserialize(params.circleBridgeMessage)[0],
                        attestation: encoding.hex.encode(params.circleAttestation, true),
                    };

                    const txs = engine.settleOrder(highestBidder.address, fastVaa, cctpVaa, cctp);
                    await signSendMineWait(txs, highestBidderSigner);

                    const balanceAfter = await usdc.balanceOf(await highestBidder.getAddress());
                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        expectedAmount.toString(),
                    );
                });
            });
            describe(`Penalized Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT,
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                        return await IERC20__factory.connect(
                            fromEnv.tokenAddress,
                            fromWallet,
                        ).balanceOf(fromWallet.address);
                    })();
                    localVariables.set("amountIn", amountIn);

                    const order: TokenRouter.OrderRequest = {
                        amountIn,
                        minAmountOut: BigInt(0),
                        deadline: 0,
                        maxFee: FEE_AMOUNT,
                        targetChain: toChainName,
                        redeemer: toUniversal(toChainName, toWallet.address),
                        redeemerMessage: encoding.bytes.encode("All your base are belong to us."),
                        refundAddress: toUniversal(fromChainName, fromWallet.address),
                    };

                    const txs = fromTokenRouter.placeFastMarketOrder(fromWallet.address, order);
                    const receipt = await signSendMineWait(txs, fromSigner);
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt!.hash,
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(fromEnv.tokenRouterAddress),
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse",
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt!,
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set(
                        "fastVaa",
                        deserialize("FastTransfer:FastMarketOrder", fastVaa),
                    );
                });

                it(`Matching Engine -- Start Fast Order Auction`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;

                    // Parse the vaa, we will need the hash for later.
                    const auctionId = FastTransfer.auctionId(fastVaa);
                    localVariables.set("auctionId", auctionId);

                    const { amountIn, maxFee } = fastVaa.payload;

                    // Security deposit amount of the initial bid.
                    const initialDeposit = amountIn + maxFee;

                    const initialBidderAddress = await initialBidder.getAddress();
                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, initialBidder);
                    await mintNativeUsdc(usdc, initialBidderAddress, initialDeposit);

                    const balanceBefore = await usdc.balanceOf(initialBidderAddress);

                    const txs = engine.placeInitialOffer(
                        initialBidderAddress,
                        fastVaa,
                        maxFee,
                        initialDeposit,
                    );
                    const receipt = await signSendMineWait(txs, initialBidderSigner);

                    const balanceAfter = await usdc.balanceOf(initialBidderAddress);
                    expect((balanceBefore - balanceAfter).toString()).to.eql(
                        initialDeposit.toString(),
                    );

                    // Validate state changes.
                    const auctionData = await engine.liveAuctionInfo(auctionId);

                    expect(auctionData.status).to.eql(1n);
                    expect(auctionData.startBlock.toString()).to.eql(
                        receipt!.blockNumber.toString(),
                    );
                    expect(auctionData.highestBidder).to.eql(initialBidderAddress);
                    expect(auctionData.initialBidder).to.eql(initialBidderAddress);
                    expect(auctionData.amount.toString()).to.eql(amountIn.toString());
                    expect(auctionData.securityDeposit.toString()).to.eql(maxFee.toString());
                    expect(auctionData.bidPrice.toString()).to.eql(maxFee.toString());
                });

                it(`Matching Engine -- Fast Order Auction Period`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    const auctionInfoBefore = await engine.liveAuctionInfo(auctionId);
                    const startingBid = auctionInfoBefore.bidPrice;
                    const initialDeposit =
                        auctionInfoBefore.amount + auctionInfoBefore.securityDeposit;
                    expect(startingBid > 0n && initialDeposit > 0n).is.true;

                    // Create array of test bids. This structure should not change, otherwise
                    // the following tests will fail.
                    const bids: ScoreKeeper[] = [
                        {
                            player: bidderTwo,
                            bid: startingBid - 1n,
                            balance: 0n,
                        },
                        {
                            player: bidderThree,
                            bid: startingBid / 2n,
                            balance: 0n,
                        },
                        {
                            player: highestBidder,
                            bid: startingBid / 3n,
                            balance: 0n,
                        },
                    ];

                    // Loop through and make multiple bids in the same block.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const playerAddress = await player.getAddress();
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        await mintNativeUsdc(usdc, playerAddress, initialDeposit, false);

                        // give it time to hit the mempool
                        await sleep(1);

                        bids[i].balance = await usdc.balanceOf(playerAddress);

                        const txs = engine.improveOffer(playerAddress, fastVaa, bids[i].bid);
                        await signSendOnly(txs, getSdkSigner(MATCHING_ENGINE_NAME, player));
                    }
                    // Mine the block.
                    await mine(engineProvider);

                    // Validate balance changes. The lowest bid should have zero balance, the others
                    // should've been refunded.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        const balanceAfter = await usdc.balanceOf(await player.getAddress());

                        if (i == 2) {
                            expect((balanceAfter - bids[i].balance).toString()).to.eql("0");
                        } else {
                            expect(balanceAfter.toString()).to.eql(
                                (bids[i].balance + initialDeposit).toString(),
                            );
                        }
                    }

                    // Validate state changes.
                    const auctionInfoAfter = await engine.liveAuctionInfo(auctionId);

                    expect(auctionInfoAfter.status).to.eql(1n);
                    expect(auctionInfoAfter.startBlock.toString()).to.eql(
                        auctionInfoBefore.startBlock.toString(),
                    );
                    expect(auctionInfoAfter.highestBidder).to.eql(await highestBidder.getAddress());
                    expect(auctionInfoAfter.initialBidder).to.eql(auctionInfoBefore.initialBidder);
                    expect(auctionInfoAfter.amount.toString()).to.eql(
                        auctionInfoBefore.amount.toString(),
                    );
                    expect(auctionInfoAfter.securityDeposit.toString()).to.eql(
                        auctionInfoBefore.securityDeposit.toString(),
                    );
                    expect(auctionInfoAfter.bidPrice.toString()).to.eql(bids[2].bid.toString());
                });

                it(`Matching Engine -- Execute Fast Order As Liquidator (After Grace Period Ends)`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    // Mine 50% of the way through the penalty period.
                    await engine
                        .getPenaltyBlocks()
                        .then((blocks) =>
                            mineToPenaltyPeriod(
                                auctionId,
                                engine,
                                engineProvider,
                                Number(blocks / 2n),
                            ),
                        );

                    // Fetch the initial bidder so we can do a balance check.
                    const auctionInfo = await engine.liveAuctionInfo(auctionId);

                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, highestBidder);
                    const balanceBefore = await usdc.balanceOf(await highestBidder.getAddress());
                    const balanceLiquidatorBefore = await usdc.balanceOf(
                        await liquidator.getAddress(),
                    );
                    const initialBidderBefore = await usdc.balanceOf(auctionInfo.initialBidder);

                    const receipt = await engine
                        .connect(liquidator.provider!)
                        .executeFastOrderTx(serialize(fastVaa))
                        .then((txReq) => liquidator.sendTransaction(txReq))
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const [penalty, reward] = await engine.calculateDynamicPenalty(auctionId);

                    const transactionResult = await engine.getTransactionResults(receipt!.hash);

                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(engine.address),
                    );
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Validate state and balance changes.
                    const balanceAfter = await usdc.balanceOf(await highestBidder.getAddress());
                    const initialBidderAfter = await usdc.balanceOf(auctionInfo.initialBidder);
                    const balanceLiquidatorAfter = await usdc.balanceOf(
                        await liquidator.getAddress(),
                    );
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();

                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (
                            auctionInfo.bidPrice +
                            auctionInfo.securityDeposit -
                            (penalty + reward)
                        ).toString(),
                    );
                    expect((balanceLiquidatorAfter - balanceLiquidatorBefore).toString()).to.eql(
                        penalty.toString(),
                    );
                    expect(initialBidderAfter - initialBidderBefore).eq(initAuctionFee);

                    // Auction status should be complete (2).
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2n);

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt!,
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("reward", reward);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const reward = localVariables.get("reward") as string;
                    expect(localVariables.delete("reward")).is.true;
                    expect(localVariables.delete("fastOrderResponse")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const { vaa, cctp } = decodedOrderResponse(orderResponse);
                    const txs = toTokenRouter.redeemFill(toWallet.address, vaa, cctp);
                    await signSendMineWait(txs, toSigner);

                    // Validate balance changes.
                    const [bidPrice, amount] = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => [info.bidPrice, info.amount]);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    // Add the reward, since the fast auction wasn't executed during
                    // the grace period.
                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (amount - bidPrice - initAuctionFee + reward).toString(),
                    );
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;
                    expect(localVariables.delete("auctionId")).is.true;

                    // Fetch balance of player four since they were the highest bidder.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const balanceBefore = await usdc.balanceOf(await highestBidder.getAddress());
                    const expectedAmount = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.amount);

                    const cctpVaa = deserialize(
                        "FastTransfer:CctpDeposit",
                        params.encodedWormholeMessage,
                    );
                    const cctp = {
                        message: CircleBridge.deserialize(params.circleBridgeMessage)[0],
                        attestation: encoding.hex.encode(params.circleAttestation, true),
                    };

                    const txs = engine.settleOrder(
                        highestBidderSigner.address(),
                        fastVaa,
                        cctpVaa,
                        cctp,
                    );
                    await signSendMineWait(txs, highestBidderSigner);

                    const balanceAfter = await usdc.balanceOf(await highestBidder.getAddress());
                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        expectedAmount.toString(),
                    );
                });
            });
            describe(`No Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT,
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                        return await IERC20__factory.connect(
                            fromEnv.tokenAddress,
                            fromWallet,
                        ).balanceOf(fromWallet.address);
                    })();
                    localVariables.set("amountIn", amountIn);

                    const order: TokenRouter.OrderRequest = {
                        amountIn,
                        minAmountOut: BigInt(0),
                        deadline: 0,
                        maxFee: FEE_AMOUNT,
                        targetChain: toChainName,
                        redeemer: toUniversal(toChainName, toWallet.address),
                        redeemerMessage: encoding.bytes.encode("All your base are belong to us."),
                        refundAddress: toUniversal(fromChainName, fromWallet.address),
                    };
                    const txs = fromTokenRouter.placeFastMarketOrder(fromWallet.address, order);
                    const receipt = await signSendMineWait(txs, fromSigner);
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt!.hash,
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(fromEnv.tokenRouterAddress),
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse",
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt!,
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set(
                        "fastVaa",
                        deserialize("FastTransfer:FastMarketOrder", fastVaa),
                    );
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;

                    // NOTE: Imagine that several minutes have passed, and no auction has been started :).

                    // Parse the slow VAA for the baseFee and amount
                    const slowVaa = deserialize(
                        "FastTransfer:CctpDeposit",
                        params.encodedWormholeMessage,
                    );
                    const deposit = slowVaa.payload;

                    if (deposit.payload.id !== payloadIds("SlowOrderResponse"))
                        throw new Error("Invalid message type");

                    const { baseFee } = deposit.payload;

                    // Use player one as the relayer.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const feeRecipientBefore = await usdc.balanceOf(engineEnv.feeRecipient!);

                    const cctp = {
                        message: CircleBridge.deserialize(params.circleBridgeMessage)[0],
                        attestation: encoding.hex.encode(params.circleAttestation, true),
                    };
                    const txs = engine.settleOrder(initialBidder.address, fastVaa, slowVaa, cctp);
                    const receipt = await signSendMineWait(txs, initialBidderSigner);

                    // Balance check.
                    const feeRecipientAfter = await usdc.balanceOf(engineEnv.feeRecipient!);
                    expect((feeRecipientAfter - feeRecipientBefore).toString()).to.eql(
                        baseFee.toString(),
                    );

                    const transactionResult = await engine.getTransactionResults(receipt!.hash);

                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(engine.address),
                    );
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt!,
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    // Confirm that the auction was market as complete.
                    const auctionId = FastTransfer.auctionId(fastVaa);
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2n);

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("baseFee", baseFee);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const baseFee = localVariables.get("baseFee") as bigint;
                    expect(localVariables.delete("fastOrderResponse")).is.true;
                    expect(localVariables.delete("baseFee")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const { vaa, cctp } = decodedOrderResponse(orderResponse);
                    const txs = toTokenRouter.redeemFill(toWallet.address, vaa, cctp);
                    await signSendMineWait(txs, toSigner);

                    // Validate balance changes.
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (TEST_AMOUNT - baseFee).toString(),
                    );
                });
            });
            describe(`No Auction - Deadline Exceeded`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT,
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                        return await IERC20__factory.connect(
                            fromEnv.tokenAddress,
                            fromWallet,
                        ).balanceOf(fromWallet.address);
                    })();

                    localVariables.set("amountIn", amountIn);

                    // Set the deadline to the current block timestamp.
                    const currentBlock = await engineProvider.getBlockNumber();
                    const deadline = (await engineProvider.getBlock(currentBlock))!.timestamp;

                    const order: TokenRouter.OrderRequest = {
                        amountIn,
                        deadline,
                        minAmountOut: 0n,
                        redeemer: toUniversal(toChainName, toWallet.address),
                        maxFee: FEE_AMOUNT,
                        targetChain: toChainName,
                        redeemerMessage: encoding.bytes.encode("All your base are belong to us."),
                        refundAddress: toUniversal(fromChainName, fromWallet.address),
                    };

                    const txs = fromTokenRouter.placeFastMarketOrder(fromWallet.address, order);
                    const receipt = await signSendMineWait(txs, fromSigner);

                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt!.hash,
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(fromEnv.tokenRouterAddress),
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse",
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt!,
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set(
                        "fastVaa",
                        deserialize("FastTransfer:FastMarketOrder", fastVaa),
                    );
                });

                it(`Matching Engine -- Attempt to Start Auction After Deadline`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;

                    // Parse the vaa, we will need the hash for later.
                    const auctionId = FastTransfer.auctionId(fastVaa);
                    localVariables.set("auctionId", auctionId);

                    const { amountIn, maxFee } = fastVaa.payload;

                    // Security deposit amount of the initial bid.
                    const initialDeposit = amountIn + maxFee;

                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, initialBidder);
                    await mintNativeUsdc(usdc, await initialBidder.getAddress(), initialDeposit);
                    await usdc
                        .approve(engine.address, initialDeposit)
                        .then((tx) => mineWait(engineProvider, tx));

                    let failedGracefully = false;
                    const receipt = await engine
                        .connect(initialBidder.provider!)
                        .placeInitialBidTx(serialize(fastVaa), maxFee)
                        .then(async (txReq) => await initialBidder.sendTransaction(txReq))
                        .catch((err) => {
                            const error = errorDecoder(err);
                            if (error.selector == "ErrDeadlineExceeded") {
                                failedGracefully = true;
                            }
                        });

                    expect(failedGracefully).is.true;
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const fastVaa = localVariables.get(
                        "fastVaa",
                    ) as VAA<"FastTransfer:FastMarketOrder">;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;

                    // NOTE: Imagine that several minutes have passed, and no auction has been started :).

                    const slowVaa = deserialize(
                        "FastTransfer:CctpDeposit",
                        params.encodedWormholeMessage,
                    );

                    if (slowVaa.payload.payload.id !== payloadIds("SlowOrderResponse"))
                        throw new Error("Invalid message type");

                    // Parse the slow VAA for the baseFee and amount
                    const { baseFee } = slowVaa.payload.payload;

                    // Use player one as the relayer.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const feeRecipientBefore = await usdc.balanceOf(engineEnv.feeRecipient!);

                    const txs = engine.settleOrder(initialBidder.address, fastVaa, slowVaa, {
                        message: CircleBridge.deserialize(params.circleBridgeMessage)[0],
                        attestation: encoding.hex.encode(params.circleAttestation, true),
                    });

                    const receipt = await signSendMineWait(txs, initialBidderSigner);

                    // Balance check.
                    const feeRecipientAfter = await usdc.balanceOf(engineEnv.feeRecipient!);
                    expect((feeRecipientAfter - feeRecipientBefore).toString()).to.eql(
                        baseFee.toString(),
                    );

                    const transactionResult = await engine.getTransactionResults(receipt!.hash);

                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        asUniversalBytes(engine.address),
                    );
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt!,
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    // Confirm that the auction was market as complete.
                    const auctionId = keccak256(fastVaa.hash);
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2n);

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("baseFee", baseFee);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const baseFee = localVariables.get("baseFee") as bigint;
                    expect(localVariables.delete("fastOrderResponse")).is.true;
                    expect(localVariables.delete("baseFee")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const slowVaa = deserialize(
                        "FastTransfer:CctpDeposit",
                        orderResponse.encodedWormholeMessage,
                    );

                    const cctp = {
                        message: CircleBridge.deserialize(orderResponse.circleBridgeMessage)[0],
                        attestation: encoding.hex.encode(orderResponse.circleAttestation, true),
                    };

                    const txs = toTokenRouter.redeemFill(toWallet.address, slowVaa, cctp);
                    await signSendMineWait(txs, toSigner);

                    // Validate balance changes.
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect((balanceAfter - balanceBefore).toString()).to.eql(
                        (TEST_AMOUNT - baseFee).toString(),
                    );
                });
            });
        });
    }
});
