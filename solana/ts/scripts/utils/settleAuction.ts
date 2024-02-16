import * as wormholeSdk from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import * as splToken from "@solana/spl-token";
import { PreparedTransaction } from "../../src";
import { Auction, MatchingEngineProgram } from "../../src/matchingEngine";
import {
    ParsedVaaWithBytes,
    StandardRelayerApp,
    StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";
import * as utils from "../utils";
import * as winston from "winston";

async function fetchCctpArgs(
    cfg: utils.AppConfig,
    app: StandardRelayerApp<StandardRelayerContext>,
    ctx: StandardRelayerContext,
    logicLogger: winston.Logger,
    finalizedVaa: ParsedVaaWithBytes,
    fromChain: wormholeSdk.ChainName,
    rpc: string,
    coreBridgeAddress: string,
): Promise<{ encodedCctpMessage: Buffer; cctpAttestation: Buffer } | undefined> {
    // Fetch the source tx hash.
    const txHash = await utils.fetchTxHashWithRetry(
        cfg,
        app,
        ctx.sourceTxHash ?? "",
        finalizedVaa,
        logicLogger,
    );

    if (txHash === null) {
        logicLogger.error(
            `Could not find txHash: vaas/${
                finalizedVaa.emitterChain
            }/${finalizedVaa.emitterAddress.toString("hex")}/${finalizedVaa.sequence}`,
        );
        return undefined;
    }

    const cctpArgs = await (async () => {
        if (wormholeSdk.isEVMChain(fromChain)) {
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
    finalizedVaaBytes: Uint8Array,
    fastVaaBytes: Uint8Array,
): SettleAuctionAccounts {
    const auction = matchingEngine.auctionAddress(
        wormholeSdk.keccak256(wormholeSdk.parseVaa(fastVaaBytes).hash),
    );
    const finalizedVaaAccount = derivePostedVaaKey(
        matchingEngine.coreBridgeProgramId(),
        wormholeSdk.parseVaa(finalizedVaaBytes).hash,
    );
    const fastVaaAccount = derivePostedVaaKey(
        matchingEngine.coreBridgeProgramId(),
        wormholeSdk.parseVaa(fastVaaBytes).hash,
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
    app: StandardRelayerApp<StandardRelayerContext>,
    ctx: StandardRelayerContext,
    logicLogger: winston.Logger,
    finalizedVaa: ParsedVaaWithBytes,
    payer: Keypair,
): Promise<PreparedTransaction[]> {
    await new Promise((resolve) => setTimeout(resolve, 20_000));

    const unproccessedTxns: PreparedTransaction[] = [];

    const {
        chain: fromChain,
        rpc,
        coreBridgeAddress,
    } = cfg.unsafeChainCfg(finalizedVaa.emitterChain);

    logicLogger.debug(`Attempting to fetch fast VAA, finalized sequence=${finalizedVaa.sequence}`);
    const fetchedFastVaa = await app.fetchVaa(
        fromChain,
        finalizedVaa.emitterAddress,
        finalizedVaa.sequence + 1n,
        {
            retryTimeout: 1_000,
            retries: 10,
        },
    );

    const fastOrder = utils.tryParseFastMarketOrder(fetchedFastVaa);
    if (fastOrder === undefined) {
        logicLogger.error(`Failed to parse FastMarketOrder, sequence=${finalizedVaa.sequence}`);
        return unproccessedTxns;
    }

    // Fetch accounts needed to settle the auction.
    const { auction, finalizedVaaAccount, fastVaaAccount } = getSettleAuctionAccounts(
        matchingEngine,
        finalizedVaa.bytes,
        fetchedFastVaa.bytes,
    );

    // Fetch the auction data.
    let auctionData: Auction = {} as Auction;
    try {
        auctionData = await matchingEngine.fetchAuction({ address: auction });
    } catch (e) {
        logicLogger.error(`No auction found, sequence=${fetchedFastVaa.sequence}`);
        return unproccessedTxns;
    }

    // Fetch the CCTP message and attestation.
    const cctpArgs = await fetchCctpArgs(
        cfg,
        app,
        ctx,
        logicLogger,
        finalizedVaa,
        fromChain,
        rpc,
        coreBridgeAddress,
    );
    if (cctpArgs === undefined) {
        logicLogger.error("Failed to fetch CCTP args");
        return unproccessedTxns;
    }

    // Create the instructions to post the fast VAA if it hasn't been posted already.
    const isPosted = await connection
        .getAccountInfo(finalizedVaaAccount)
        .then((info) => info !== null);

    if (!isPosted) {
        logicLogger.debug(
            `Prepare verify signatures and post VAA, sequence=${finalizedVaa.sequence}`,
        );
        const preparedPostVaaTxs = await utils.preparePostVaaTxs(
            connection,
            cfg,
            matchingEngine,
            payer,
            finalizedVaa,
            { preflightCommitment: cfg.solanaCommitment() },
        );
        unproccessedTxns.push(...preparedPostVaaTxs);
    }

    // Fetch token account for the payer.
    const executorToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        payer.publicKey,
    );

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    // Prepare the settle auction transaction.
    const settleAuctionActiveTx = await matchingEngine.settleAuctionActiveTx(
        {
            payer: payer.publicKey,
            fastVaa: fastVaaAccount,
            finalizedVaa: finalizedVaaAccount,
            executorToken,
        },
        cctpArgs,
        [payer],
        {
            computeUnits: cfg.settleAuctionActiveComputeUnits(),
            feeMicroLamports: 10,
            nonceAccount: cfg.solanaNonceAccount(),
            addressLookupTableAccounts: [lookupTableAccount!],
        },
        {
            preflightCommitment: cfg.solanaCommitment(),
            skipPreflight: false,
        },
    );
    unproccessedTxns.push(settleAuctionActiveTx);

    return unproccessedTxns;
}

// TODO: Fetch the auction data and see if one of the known token accounts is the winner.
