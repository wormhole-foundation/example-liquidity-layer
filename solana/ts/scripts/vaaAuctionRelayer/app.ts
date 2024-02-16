import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
    Environment,
    StandardRelayerApp,
    StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import "dotenv/config";
import * as fs from "fs";
import { MatchingEngineProgram } from "../../src/matchingEngine";
import { PreparedTransaction } from "../../src";
import * as utils from "../utils";
import * as winston from "winston";

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

    // Contains the starting sequences for each chain.
    const startingSequences = await cfg.startingSeqeunces();

    // Cache recognized token accounts.
    const knownTokenAccounts = cfg.recognizedTokenAccounts();

    const app = new StandardRelayerApp<StandardRelayerContext>(Environment.TESTNET, {
        name: "Initialize Auctions",
        logger: utils.defaultLogger({ label: "app", level: cfg.appLogLevel() }),
        missedVaaOptions: cfg.defaultMissedVaaOptions(),
        providers: cfg.relayerAppProviderOpts(),
    });

    const logicLogger = utils.defaultLogger({ label: "logic", level: cfg.logicLogLevel() });
    logicLogger.debug("Start logging logic");

    const preparedTransactionQueue: PreparedTransaction[] = [];
    const vaaCache = utils.expiringList<string>(1000 * 60 * 5); // 5 minutes.

    spawnTransactionProcessor(connection, preparedTransactionQueue, logicLogger);

    app.multiple(cfg.emitterFilter(), async (ctx, next) => {
        const signedVaa = ctx.vaa!;

        if (startingSequences[signedVaa.emitterChain] > signedVaa.sequence) {
            logicLogger.debug(
                `Ignoring stale VAA sequence=${signedVaa.sequence}, chain=${signedVaa.emitterChain}`,
            );
            return;
        }

        // These chain ID checks are safe because we know the VAAs come from
        // chain names in the config, which are checked against ChainName.
        const { chain } = cfg.unsafeChainCfg(signedVaa.emitterChain);

        // Cache the VAA ID to avoid double processing.
        const vaaId = utils.vaaStringId(signedVaa);
        if (vaaCache.has(vaaId)) {
            return;
        } else {
            logicLogger.debug(`Found VAA: chain=${chain}, sequence=${signedVaa.sequence}`);
            vaaCache.add(vaaId);
        }

        // Start a new auction if this is a fast VAA.
        if (cfg.isFastFinality(signedVaa)) {
            logicLogger.debug(
                `Attempting to parse FastMarketOrder, sequence=${signedVaa.sequence}`,
            );
            const fastOrder = utils.tryParseFastMarketOrder(signedVaa);

            if (fastOrder !== undefined) {
                const unprocessedTxns = await utils.handlePlaceInitialOffer(
                    connection,
                    cfg,
                    matchingEngine,
                    signedVaa,
                    fastOrder,
                    payer,
                    logicLogger,
                );
                preparedTransactionQueue.push(...unprocessedTxns);
            } else {
                logicLogger.warn(`Failed to parse FastMarketOrder, sequence=${signedVaa.sequence}`);
                return;
            }
        } else {
            logicLogger.debug(
                `Attempting to parse SlowOrderResponse, sequence=${signedVaa.sequence}`,
            );
            const slowOrderResponse = utils.tryParseSlowOrderResponse(signedVaa);

            if (slowOrderResponse !== undefined) {
                const unprocessedTxns = await utils.handleSettleAuction(
                    connection,
                    cfg,
                    matchingEngine,
                    app,
                    ctx,
                    logicLogger,
                    signedVaa,
                    payer,
                );
                preparedTransactionQueue.push(...unprocessedTxns);
            } else {
                logicLogger.warn(
                    `Failed to parse SlowOrderResponse, sequence=${signedVaa.sequence}`,
                );
                return;
            }
        }

        // Done.
        await next();
    });

    logicLogger.debug("Listening");

    // Do it.
    await app.listen();
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
