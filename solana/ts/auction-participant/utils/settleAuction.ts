import * as wormholeSdk from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, Signer } from "@solana/web3.js";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import * as splToken from "@solana/spl-token";
import { PreparedTransaction } from "../../src";
import { Auction, AuctionStatus, MatchingEngineProgram } from "../../src/matchingEngine";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";
import * as utils from "../utils";
import * as winston from "winston";

async function fetchCctpArgs(
    cfg: utils.AppConfig,
    logicLogger: winston.Logger,
    finalizedVaa: wormholeSdk.ParsedVaa,
    txHash: string,
    fromChain: wormholeSdk.ChainName,
    rpc: string,
    coreBridgeAddress: string,
): Promise<{ encodedCctpMessage: Buffer; cctpAttestation: Buffer } | undefined> {
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
    finalizedVaaBytes: Uint8Array | Buffer,
    fastVaaBytes: Uint8Array | Buffer,
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
    logicLogger: winston.Logger,
    parsed: wormholeSdk.ParsedVaa,
    raw: Uint8Array,
    payer: Keypair,
): Promise<PreparedTransaction[]> {
    await new Promise((resolve) => setTimeout(resolve, 20_000));

    const unproccessedTxns: PreparedTransaction[] = [];

    const { chain: fromChain, rpc, coreBridgeAddress } = cfg.unsafeChainCfg(parsed.emitterChain);

    // Fetch the fast vaa and the source transaction hash from wormscan. We subtract one from the
    // slow vaa sequence to fetch the fast vaa bytes.
    logicLogger.debug(`Attempting to fetch fast VAA, finalized sequence=${parsed.sequence}`);
    const fastVaaSequence = Number(parsed.sequence) + 1;
    const vaaResponse = await utils.fetchVaaFromWormscan(
        cfg,
        {
            chain: parsed.emitterChain,
            sequence: fastVaaSequence,
            emitter: parsed.emitterAddress.toString("hex"),
        },
        logicLogger,
    );

    if (vaaResponse.vaa === undefined || vaaResponse.txHash === undefined) {
        logicLogger.error(`Failed to fetch fast VAA, sequence=${parsed.sequence}`);
        return [];
    }

    logicLogger.debug(`Attempting to parse fast VAA, sequence=${fastVaaSequence}`);
    const fastVaaParsed = wormholeSdk.parseVaa(vaaResponse.vaa);
    const fastOrder = utils.tryParseFastMarketOrder(fastVaaParsed.payload);
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

    const settleAuctionTx = await createSettleTx(
        connection,
        {
            executor: payer.publicKey,
            fastVaa: fastVaaAccount,
            finalizedVaa: finalizedVaaAccount,
            auction,
        },
        auctionData.status,
        cctpArgs,
        [payer],
        matchingEngine,
        cfg,
    );

    if (settleAuctionTx === undefined) {
        logicLogger.debug(`Auction is not completed, sequence=${fastVaaParsed.sequence}`);
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
    },
    status: AuctionStatus,
    cctpArgs: { encodedCctpMessage: Buffer; cctpAttestation: Buffer },
    signers: Signer[],
    matchingEngine: MatchingEngineProgram,
    cfg: utils.AppConfig,
): Promise<PreparedTransaction | undefined> {
    const { executor, fastVaa, finalizedVaa, auction } = accounts;

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    // Fetch our token account.
    const executorToken = splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, executor);
    const preparedTransactionOptions = {
        computeUnits: cfg.settleAuctionCompleteComputeUnits(),
        feeMicroLamports: 10,
        nonceAccount: cfg.solanaNonceAccount(),
        addressLookupTableAccounts: [lookupTableAccount!],
    };
    const confirmOptions = {
        commitment: cfg.solanaCommitment(),
        skipPreflight: false,
    };

    if (status.completed === undefined) {
        return undefined;
    }

    // Prepare the settle auction transaction.
    const settleAuctionTx = await matchingEngine.settleAuctionCompleteTx(
        {
            executor,
            fastVaa,
            finalizedVaa,
            bestOfferToken: executorToken,
            auction,
        },
        cctpArgs,
        signers,
        preparedTransactionOptions,
        confirmOptions,
    );

    return settleAuctionTx;
}
