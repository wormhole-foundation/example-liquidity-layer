import { Connection, Keypair, PublicKey, Signer } from "@solana/web3.js";
import { PreparedTransaction } from "@wormhole-foundation/example-liquidity-layer-solana";
import {
    Auction,
    MatchingEngineProgram,
} from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import * as utils from ".";
import * as winston from "winston";
import { Chain, chainToPlatform, toChainId } from "@wormhole-foundation/sdk-base";
import { VAA, deserialize, keccak256 } from "@wormhole-foundation/sdk-definitions";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";

async function fetchCctpArgs(
    cfg: utils.AppConfig,
    logicLogger: winston.Logger,
    finalizedVaa: VAA,
    txHash: string,
    fromChain: Chain,
    rpc: string,
    coreBridgeAddress: string,
): Promise<{ encodedCctpMessage: Buffer; cctpAttestation: Buffer } | undefined> {
    const cctpArgs = await (async () => {
        if (chainToPlatform(fromChain) === "Evm") {
            return utils.evm.unsafeFindAssociatedCctpMessageAndAttestation(
                rpc,
                cfg.cctpAttestationEndpoint(),
                coreBridgeAddress,
                txHash,
                finalizedVaa,
                logicLogger,
            );
        } else {
            logicLogger.error(`Unsupported chain: ${fromChain}`);
        }
    })();

    return cctpArgs;
}

export interface SettleAuctionAccounts {
    finalizedVaaAccount: PublicKey;
    fastVaaAccount: PublicKey;
    auction: PublicKey;
}

function getSettleAuctionAccounts(
    matchingEngine: MatchingEngineProgram,
    finalizedVaaBytes: Uint8Array | Buffer,
    fastVaaBytes: Uint8Array | Buffer,
): SettleAuctionAccounts {
    const fastVaa = deserialize("Uint8Array", fastVaaBytes);
    const auction = matchingEngine.auctionAddress(keccak256(fastVaa.hash));
    const fastVaaAccount = coreUtils.derivePostedVaaKey(
        matchingEngine.coreBridgeProgramId(),
        Buffer.from(fastVaa.hash),
    );

    const finalizedVaa = deserialize("Uint8Array", finalizedVaaBytes);
    const finalizedVaaAccount = coreUtils.derivePostedVaaKey(
        matchingEngine.coreBridgeProgramId(),
        Buffer.from(finalizedVaa.hash),
    );

    return {
        auction,
        finalizedVaaAccount,
        fastVaaAccount,
    };
}

export async function handleSettleAuction(
    connection: Connection,
    cfg: utils.AppConfig,
    matchingEngine: MatchingEngineProgram,
    logicLogger: winston.Logger,
    parsed: VAA,
    raw: Uint8Array,
    payer: Keypair,
): Promise<PreparedTransaction[]> {
    // Since this testnet, Avax is enabled to send fast orders.
    // We need to wait for the auction to be completed before we can settle it.
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const unproccessedTxns: PreparedTransaction[] = [];

    const {
        chain: fromChain,
        rpc,
        coreBridgeAddress,
    } = cfg.unsafeChainCfg(toChainId(parsed.emitterChain));

    // Fetch the fast vaa and the source transaction hash from wormscan. We subtract one from the
    // slow vaa sequence to fetch the fast vaa bytes.
    logicLogger.debug(`Attempting to fetch fast VAA, finalized sequence=${parsed.sequence}`);
    const fastVaaSequence = Number(parsed.sequence) + 1;
    const vaaResponse = await utils.fetchVaaFromWormscan(
        cfg,
        {
            chain: toChainId(parsed.emitterChain),
            sequence: fastVaaSequence,
            emitter: parsed.emitterAddress.toString(),
        },
        logicLogger,
    );

    if (vaaResponse.vaa === undefined || vaaResponse.txHash === undefined) {
        logicLogger.error(`Failed to fetch fast VAA, sequence=${parsed.sequence}`);
        return [];
    }

    logicLogger.debug(`Attempting to parse fast VAA, sequence=${fastVaaSequence}`);
    const fastVaaParsed = deserialize("Uint8Array", vaaResponse.vaa);
    const fastOrder = utils.tryParseFastMarketOrder(Buffer.from(fastVaaParsed.payload));
    if (fastOrder === undefined) {
        logicLogger.error(`Failed to parse FastMarketOrder, sequence=${fastVaaSequence}`);
        return [];
    }

    // Fetch accounts needed to settle the auction.
    const { auction, finalizedVaaAccount, fastVaaAccount } = getSettleAuctionAccounts(
        matchingEngine,
        raw,
        vaaResponse.vaa,
    );

    // Fetch the auction data.
    let auctionData: Auction = {} as Auction;
    try {
        auctionData = await matchingEngine.fetchAuction({ address: auction });

        if (!cfg.isRecognizedTokenAccount(auctionData.info!.bestOfferToken)) {
            logicLogger.error(
                `Auction winner token account is not recognized, sequence=${fastVaaParsed.sequence}`,
            );
            return [];
        }
    } catch (e) {
        logicLogger.error(`No auction found, sequence=${fastVaaParsed.sequence}`);
        return [];
    }

    // Check to see if the auction is complete.
    if (auctionData.status.completed === undefined) {
        logicLogger.error(`Auction is not completed, sequence=${fastVaaParsed.sequence}`);
        return [];
    }

    if (auctionData.status.settled !== undefined) {
        logicLogger.info(`Auction has already been settled, sequence=${fastVaaParsed.sequence}`);
        return [];
    }

    // Fetch the CCTP message and attestation.
    const cctpArgs = await fetchCctpArgs(
        cfg,
        logicLogger,
        parsed,
        vaaResponse.txHash,
        fromChain,
        rpc,
        coreBridgeAddress,
    );
    if (cctpArgs === undefined) {
        logicLogger.error("Failed to fetch CCTP args");
        return [];
    }

    // Create the instructions to post the fast VAA if it hasn't been posted already.
    const isPosted = await connection
        .getAccountInfo(finalizedVaaAccount)
        .then((info) => info !== null);

    if (!isPosted) {
        logicLogger.debug(`Prepare verify signatures and post VAA, sequence=${parsed.sequence}`);
        const preparedPostVaaTxs = await utils.preparePostVaaTxs(
            connection,
            cfg,
            matchingEngine,
            payer,
            parsed,
            { commitment: cfg.solanaCommitment() },
        );
        unproccessedTxns.push(...preparedPostVaaTxs);
    }

    logicLogger.debug(
        `Prepare settle auction, sequence=${fastVaaParsed.sequence}, auction=${auction}`,
    );
    const settleAuctionTx = await createSettleTx(
        connection,
        {
            executor: payer.publicKey,
            fastVaa: fastVaaAccount,
            finalizedVaa: finalizedVaaAccount,
            auction,
            bestOfferToken: auctionData.info!.bestOfferToken,
        },
        cctpArgs,
        [payer],
        matchingEngine,
        cfg,
    );

    if (settleAuctionTx === undefined) {
        logicLogger.debug(
            `Failed to create settle auction instruction, sequence=${fastVaaParsed.sequence}`,
        );
        return [];
    } else {
        unproccessedTxns.push(settleAuctionTx!);
        return unproccessedTxns;
    }
}

async function createSettleTx(
    connection: Connection,
    accounts: {
        executor: PublicKey;
        fastVaa: PublicKey;
        finalizedVaa: PublicKey;
        auction: PublicKey;
        bestOfferToken: PublicKey;
    },
    cctpArgs: { encodedCctpMessage: Buffer; cctpAttestation: Buffer },
    signers: Signer[],
    matchingEngine: MatchingEngineProgram,
    cfg: utils.AppConfig,
): Promise<PreparedTransaction | undefined> {
    const { executor, fastVaa, finalizedVaa, auction, bestOfferToken } = accounts;

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    // Fetch our token account.
    const preparedTransactionOptions = {
        computeUnits: cfg.settleAuctionCompleteComputeUnits(),
        feeMicroLamports: 10,
        addressLookupTableAccounts: [lookupTableAccount!],
    };
    const confirmOptions = {
        commitment: cfg.solanaCommitment(),
        skipPreflight: false,
    };

    // Prepare the settle auction transaction.
    const settleAuctionTx = await matchingEngine.settleAuctionCompleteTx(
        {
            executor,
            fastVaa,
            finalizedVaa,
            bestOfferToken,
            auction,
        },
        cctpArgs,
        signers,
        preparedTransactionOptions,
        confirmOptions,
    );

    return settleAuctionTx;
}
