import * as wormholeSdk from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, Signer } from "@solana/web3.js";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import * as splToken from "@solana/spl-token";
import { PreparedTransaction } from "../../src";
import { Auction, AuctionStatus, MatchingEngineProgram } from "../../src/matchingEngine";
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
    knownTokenAccounts: PublicKey[],
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

    const settleAuctionTx = await createSettleTx(
        connection,
        {
            payer: payer.publicKey,
            fastVaa: fastVaaAccount,
            finalizedVaa: finalizedVaaAccount,
            auction,
        },
        cctpArgs,
        [payer],
        matchingEngine,
        cfg,
        knownTokenAccounts,
        logicLogger,
    );
    //unproccessedTxns.push(settleAuctionTx);

    return unproccessedTxns;
}

// TODO: Fetch the auction data and see if one of the known token accounts is the winner.
// TODO: Check auction status and determine which instruction to use.

async function createSettleTx(
    connection: Connection,
    accounts: {
        payer: PublicKey;
        fastVaa: PublicKey;
        finalizedVaa: PublicKey;
        auction: PublicKey;
    },
    cctpArgs: { encodedCctpMessage: Buffer; cctpAttestation: Buffer },
    signers: Signer[],
    matchingEngine: MatchingEngineProgram,
    cfg: utils.AppConfig,
    knownTokenAccounts: PublicKey[],
    logicLogger: winston.Logger,
) {
    const { payer, fastVaa, finalizedVaa, auction } = accounts;

    // Fetch auction data again (could've changed since the last rpc request).
    const { status, info } = await matchingEngine.fetchAuction({ address: auction });

    if (!knownTokenAccounts.includes(info!.bestOfferToken)) {
        logicLogger.debug("Auction winner is not a known token account");
        return [];
    }

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    // Fetch our token account.
    const executorToken = splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, payer);

    console.log(status);
    // Prepare the settle auction transaction.
    // const settleAuctionTx = (() => {
    //     if (status === AuctionStatus.active)
    // })

    // await matchingEngine.settleAuctionActiveTx(
    //     {
    //         payer,
    //         fastVaa,
    //         finalizedVaa,
    //         executorToken,
    //         auction,
    //     },
    //     cctpArgs,
    //     signers,
    //     {
    //         computeUnits: cfg.settleAuctionActiveComputeUnits(),
    //         feeMicroLamports: 10,
    //         nonceAccount: cfg.solanaNonceAccount(),
    //         addressLookupTableAccounts: [lookupTableAccount!],
    //     },
    //     {
    //         preflightCommitment: cfg.solanaCommitment(),
    //         skipPreflight: false,
    //     },
    // );
    // return settleAuctionActiveTx;

    return [];
}
