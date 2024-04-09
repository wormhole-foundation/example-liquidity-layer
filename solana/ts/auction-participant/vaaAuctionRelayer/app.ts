import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as wormholeSdk from "@certusone/wormhole-sdk";
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

    // TODO: Config all of these params.
    // Connect to spy.
    const spy = new VaaSpy({
        spyHost: "localhost:7073",
        vaaFilters: cfg.emitterFilterForSpy(),
        enableCleanup: true,
        seenThresholdMs: 300_000,
        intervalMs: 500,
        maxToRemove: 5,
    });
    const DELAYED_VAA_THRESHOLD = 60; // Seconds.

    spy.onObservation(async ({ raw, parsed, chain }) => {
        // Since were using the vaa timestamp, there is potentially some clock drift. However,
        // we don't want to accept VAA's that are too far in the past.
        const currTime = Math.floor(Date.now() / 1000);
        if (currTime - parsed.timestamp > DELAYED_VAA_THRESHOLD) {
            logicLogger.info(
                `Ignoring stale VAA, chain=${chain}, sequence=${parsed.sequence}, unixTime=${currTime}, vaaTime=${parsed.timestamp}`,
            );
            return;
        } else {
            logicLogger.debug(
                `Received valid VAA, chain=${chain}, sequence=${parsed.sequence}, unixTime=${currTime}, vaaTime=${parsed.timestamp}`,
            );
        }

        if (cfg.isFastFinality(parsed)) {
            // Start a new auction if this is a fast VAA.
            logicLogger.debug(`Attempting to parse FastMarketOrder, sequence=${parsed.sequence}`);
            const fastOrder = utils.tryParseFastMarketOrder(parsed.payload);
            if (fastOrder !== undefined) {
                const unprocessedTxns = await utils.handlePlaceInitialOffer(
                    connection,
                    cfg,
                    matchingEngine,
                    parsed,
                    raw,
                    fastOrder,
                    payer,
                    logicLogger,
                );
                preparedTransactionQueue.push(...unprocessedTxns);
            } else {
                logicLogger.warn(`Failed to parse FastMarketOrder, sequence=${parsed.sequence}`);
                return;
            }
        } else {
            logicLogger.debug(`Attempting to parse SlowOrderResponse, sequence=${parsed.sequence}`);
            const slowOrderResponse = utils.tryParseSlowOrderResponse(parsed.payload);
            if (slowOrderResponse !== undefined) {
                const unprocessedTxns = await utils.handleSettleAuction(
                    connection,
                    cfg,
                    matchingEngine,
                    logicLogger,
                    parsed,
                    raw,
                    payer,
                );
                preparedTransactionQueue.push(...unprocessedTxns);
            } else {
                logicLogger.warn(`Failed to parse SlowOrderResponse, sequence=${parsed.sequence}`);
                return;
            }
        }
    });
}

async function spawnTransactionProcessor(
    connection: Connection,
    preparedTransactionQueue: PreparedTransaction[],
    logger: winston.Logger,
) {
    while (true) {
        if (preparedTransactionQueue.length == 0) {
            // Finally sleep so we don't spin so hard.
            await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
            logger.debug(`Found queued transactions (length=${preparedTransactionQueue.length})`);
            const preparedTransaction = preparedTransactionQueue.shift()!;

            await utils.sendTx(connection, preparedTransaction, logger);
        }
    }
}
