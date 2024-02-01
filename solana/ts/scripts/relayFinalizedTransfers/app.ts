import { AddressLookupTableAccount, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
    Environment,
    StandardRelayerApp,
    StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import "dotenv/config";
import * as fs from "fs";
import { LiquidityLayerMessage, PreparedTransaction } from "../../src";
import { MatchingEngineProgram } from "../../src/matchingEngine";
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
        USDC_MINT
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    const app = new StandardRelayerApp<StandardRelayerContext>(Environment.TESTNET, {
        name: "Relay Finalized Transfers",
        logger: utils.defaultLogger({ label: "app", level: cfg.appLogLevel() }),
        providers: cfg.relayerAppProviderOpts(),
    });

    const logicLogger = utils.defaultLogger({ label: "logic", level: cfg.logicLogLevel() });
    logicLogger.debug("Start logging logic");

    const preparedTransactionQueue: PreparedTransaction[] = [];
    const vaaCache = utils.expiringList<string>(1000 * 60 * 5); // 5 minutes.

    spawnTransactionProcessor(connection, preparedTransactionQueue, logicLogger);

    app.multiple(cfg.emitterFilter(), async (ctx, next) => {
        const fetchedFinalizedVaa = ctx.vaa;

        if (fetchedFinalizedVaa === undefined || cfg.isFastFinality(fetchedFinalizedVaa)) {
            return;
        }

        // Bail fast if auction doesn't exist.

        // Fetch CCTP info. These chain ID checks are safe because we know the VAAs come from
        // chain names in the config, which are checked against ChainName.
        const { chain, rpc, coreBridgeAddress } = cfg.unsafeChainCfg(
            fetchedFinalizedVaa.emitterChain
        );

        const vaaId = utils.vaaStringId(fetchedFinalizedVaa);
        if (vaaCache.has(vaaId)) {
            return;
        } else {
            logicLogger.debug(`Found VAA: chain=${chain}, seq=${fetchedFinalizedVaa.sequence}`);
            vaaCache.add(vaaId);
        }

        // This must be a slow order response. We wrap this in a try-catch to avoid the old
        // implementation's serialization. We will log the old message as an error and continue.
        {
            const { payload } = fetchedFinalizedVaa;
            try {
                const { deposit } = LiquidityLayerMessage.decode(payload);
                if (deposit === undefined || deposit.message.slowOrderResponse === undefined) {
                    logicLogger.error(
                        `Expected SlowOrderResponse, but got something else: ${payload.toString(
                            "base64"
                        )}`
                    );
                    return;
                }
            } catch (err: any) {
                logicLogger.error(
                    `Failed to decode message as Deposit::SlowOrderResponse: ${payload.toString(
                        "base64"
                    )}, ${err}`
                );
                return;
            }
        }

        logicLogger.debug(
            `Attempting to fetch fast VAA... finalized sequence=${fetchedFinalizedVaa.sequence}`
        );
        const fetchedFastVaa = await app.fetchVaa(
            chain,
            fetchedFinalizedVaa.emitterAddress,
            fetchedFinalizedVaa.sequence + 1n,
            {
                retryTimeout: 1_000,
                retries: 60,
            }
        );

        logicLogger.debug(`Is this fast market order? sequence=${fetchedFastVaa.sequence}`);
        {
            const { payload: fastVaaPayload } = fetchedFastVaa;
            try {
                const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaPayload);
                if (fastMarketOrder === undefined) {
                    logicLogger.error(
                        `Expected FastMarketOrder, but got something else: ${fastVaaPayload.toString(
                            "hex"
                        )}`
                    );
                    return;
                }
            } catch (err: any) {
                logicLogger.error(
                    `Failed to decode message as FastMarketOrder: ${fastVaaPayload.toString(
                        "hex"
                    )}, ${err}`
                );
                return;
            }
        }

        // TODO
        // 1. Fetch the fast VAA via wormhole RPC. -- DONE
        // 2. Check if the posted VAA exists. If not, generate verify signatures + post vaa
        //    instructions. Be sure to add priority fee to the instructions.
        // 3. Build the instruction to settle auction none CCTP or local depending on target chain
        //    of fast VAA.

        // const cctpArgs = await (async () => {
        //     if (wormholeSdk.isEVMChain(chain)) {
        //         return utils.evm.unsafeFindAssociatedCctpMessageAndAttestation(
        //             rpc,
        //             cfg.cctpAttestationEndpoint(),
        //             coreBridgeAddress,
        //             txHash,
        //             fetchedFinalizedVaa,
        //             logicLogger
        //         );
        //     } else {
        //         logicLogger.error(`Unsupported chain: ${chain}`);
        //     }
        // })();
        // console.log(cctpArgs);

        logicLogger.debug(`Prepare verify signatures and post VAA`);
        for (const vaa of [fetchedFastVaa, fetchedFinalizedVaa]) {
            const preparedPostVaaTxs = await utils.preparePostVaaTxs(
                connection,
                cfg,
                matchingEngine,
                payer,
                vaa
            );
            preparedTransactionQueue.push(...preparedPostVaaTxs);
        }

        // Now fetch source transaction hash if it failed to fetch earlier.
        const txHash = await utils.fetchTxHashWithRetry(
            cfg,
            app,
            ctx.sourceTxHash ?? "",
            fetchedFinalizedVaa,
            logicLogger
        );

        if (txHash === null) {
            logicLogger.error(
                `Gave up finding txHash: vaas/${
                    fetchedFinalizedVaa.emitterChain
                }/${fetchedFinalizedVaa.emitterAddress.toString("hex")}/${
                    fetchedFinalizedVaa.sequence
                }`
            );
            return;
        }

        // Done.
        await next();
    });

    logicLogger.debug("Listening");
    // Do it.
    await app.listen();
}

type SendTxOpts = {
    logger: winston.Logger;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
};

async function spawnTransactionProcessor(
    connection: Connection,
    preparedTransactionQueue: PreparedTransaction[],
    logger: winston.Logger
) {
    while (true) {
        if (preparedTransactionQueue.length == 0) {
            logger.debug("nothing in the transport queue");
            // TODO: check slot for priority fee?

            // Finally sleep so we don't spin so hard.
            await new Promise((resolve) => setTimeout(resolve, 5_000));
        } else {
            logger.debug(
                `Found items in the transport (length=${preparedTransactionQueue.length})`
            );

            const preparedTransaction = preparedTransactionQueue.shift()!;

            await utils.sendTx(connection, preparedTransaction, logger);

            // temporary sleep
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    }
}
