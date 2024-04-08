import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { tryHexToNativeString, ChainId } from "@certusone/wormhole-sdk";
import "dotenv/config";
import * as fs from "fs";
import { MatchingEngineProgram } from "../../src/matchingEngine";
import { PreparedTransaction } from "../../src";
import * as utils from "../utils";
import * as winston from "winston";
import { VaaSpy } from "../../src/wormhole/spy";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

main(process.argv);

async function main(argv: string[]) {
    const cfgJson = JSON.parse(fs.readFileSync(argv[2], "utf-8"));
    const cfg = new utils.AppConfig(cfgJson);

    const connection = new Connection(cfg.solanaRpc(), cfg.solanaCommitment());
    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    const logicLogger = utils.defaultLogger({ label: "logic", level: cfg.logicLogLevel() });
    logicLogger.debug("Start logging logic");

    const preparedTransactionQueue: PreparedTransaction[] = [];

    spawnTransactionProcessor(connection, preparedTransactionQueue, logicLogger);

    // Connect to spy.

    const spy = new VaaSpy({
        spyHost: "localhost:7073",
        vaaFilters: [
            {
                chain: "pythnet",
                nativeAddress: "G9LV2mp9ua1znRAfYwZz5cPiJMAbo1T6mbjdQsDZuMJg",
            },
        ],
        enableCleanup: true,
        seenThresholdMs: 5_000,
        intervalMs: 250,
        maxToRemove: 5,
    });

    spy.onObservation(({ raw, parsed, chain, nativeAddress }) => {
        console.log(
            "observed",
            parsed.emitterChain,
            chain,
            nativeAddress,
            tryHexToNativeString(
                parsed.emitterAddress.toString("hex"),
                parsed.emitterChain as ChainId,
            ),
            parsed.sequence,
        );
    });

    // These chain ID checks are safe because we know the VAAs come from
    // chain names in the config, which are checked against ChainName.
    //const { chain } = cfg.unsafeChainCfg(signedVaa.emitterChain);

    // // Start a new auction if this is a fast VAA.
    // if (cfg.isFastFinality(signedVaa)) {
    //     logicLogger.debug(
    //         `Attempting to parse FastMarketOrder, sequence=${signedVaa.sequence}`,
    //     );
    //     const fastOrder = utils.tryParseFastMarketOrder(signedVaa);

    //     if (fastOrder !== undefined) {
    //         const unprocessedTxns = await utils.handlePlaceInitialOffer(
    //             connection,
    //             cfg,
    //             matchingEngine,
    //             signedVaa,
    //             fastOrder,
    //             payer,
    //             logicLogger,
    //         );
    //         preparedTransactionQueue.push(...unprocessedTxns);
    //     } else {
    //         logicLogger.warn(`Failed to parse FastMarketOrder, sequence=${signedVaa.sequence}`);
    //         return;
    //     }
    // } else {
    // logicLogger.debug(
    //     `Attempting to parse SlowOrderResponse, sequence=${signedVaa.sequence}`,
    // );
    // const slowOrderResponse = utils.tryParseSlowOrderResponse(signedVaa);
    // if (slowOrderResponse !== undefined) {
    //     const unprocessedTxns = await utils.handleSettleAuction(
    //         connection,
    //         cfg,
    //         matchingEngine,
    //         app,
    //         ctx,
    //         logicLogger,
    //         signedVaa,
    //         payer,
    //     );
    //     preparedTransactionQueue.push(...unprocessedTxns);
    // } else {
    //     logicLogger.warn(
    //         `Failed to parse SlowOrderResponse, sequence=${signedVaa.sequence}`,
    //     );
    //     return;
    // }
    // }
}

async function spawnTransactionProcessor(
    connection: Connection,
    preparedTransactionQueue: PreparedTransaction[],
    logger: winston.Logger,
) {
    while (true) {
        if (preparedTransactionQueue.length == 0) {
            // Finally sleep so we don't spin so hard.
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        } else {
            logger.debug(`Found queued transactions (length=${preparedTransactionQueue.length})`);
            const preparedTransaction = preparedTransactionQueue.shift()!;

            await utils.sendTx(connection, preparedTransaction, logger);
        }
    }
}
