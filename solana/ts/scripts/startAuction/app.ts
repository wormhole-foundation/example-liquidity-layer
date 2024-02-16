import * as wormholeSdk from "@certusone/wormhole-sdk";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
    Environment,
    StandardRelayerApp,
    StandardRelayerContext,
} from "@wormhole-foundation/relayer-engine";
import "dotenv/config";
import * as fs from "fs";
import { FastMarketOrder, LiquidityLayerMessage } from "../../src";
import { PreparedTransaction } from "../../src";
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
        USDC_MINT,
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    // Contains the starting sequences for each chain.
    const startingSequences = await cfg.startingSeqeunces();

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
        const fetchedFastVaa = ctx.vaa!;

        // We only care about valid "fast finality" VAAs.
        if (fetchedFastVaa === undefined || !cfg.isFastFinality(fetchedFastVaa)) {
            return;
        }

        if (startingSequences[fetchedFastVaa.emitterChain] > fetchedFastVaa.sequence) {
            logicLogger.debug(
                `Ignoring stale VAA sequence=${fetchedFastVaa.sequence}, chain=${fetchedFastVaa.emitterChain}`,
            );
            return;
        }

        // These chain ID checks are safe because we know the VAAs come from
        // chain names in the config, which are checked against ChainName.
        const { chain } = cfg.unsafeChainCfg(fetchedFastVaa.emitterChain);

        // Cache the VAA ID to avoid double processing.
        const vaaId = utils.vaaStringId(fetchedFastVaa);
        if (vaaCache.has(vaaId)) {
            return;
        } else {
            logicLogger.debug(`Found VAA: chain=${chain}, sequence=${fetchedFastVaa.sequence}`);
            vaaCache.add(vaaId);
        }

        // Save the parsed fast market order, we will need information to help post an offer.
        let order: FastMarketOrder;
        {
            logicLogger.debug(`Parsing FastMarketOrder, sequence=${fetchedFastVaa.sequence}`);
            const { payload } = fetchedFastVaa;
            try {
                let { fastMarketOrder } = LiquidityLayerMessage.decode(payload);
                if (fastMarketOrder === undefined) {
                    logicLogger.error(
                        `Expected FastMarketOrder, but got something else: ${payload.toString(
                            "hex",
                        )}`,
                    );
                    return;
                } else {
                    order = fastMarketOrder;
                }
            } catch (err: any) {
                logicLogger.error(
                    `Failed to decode message as FastMarketOrder: ${payload.toString(
                        "hex",
                    )}, ${err}`,
                );
                return;
            }
        }

        // See if the `maxFee` meets our minimum price threshold.
        const { shouldPlaceOffer, fvWithEdge } = isFeeHighEnough(
            order,
            cfg.pricingParameters(fetchedFastVaa.emitterChain),
        );
        if (!shouldPlaceOffer) {
            logicLogger.warn(
                `Skipping sequence=${fetchedFastVaa.sequence} fee too low, maxFee=${order.maxFee}, fvWithEdge=${fvWithEdge}`,
            );
            return;
        }

        // See if we have enough funds to place the initial offer.
        const totalDeposit = order.amountIn + order.maxFee;
        const isSufficient = utils.isBalanceSufficient(connection, payer.publicKey, totalDeposit);

        if (!isSufficient) {
            logicLogger.warn(
                `Insufficient balance to place initial offer, sequence=${fetchedFastVaa.sequence}`,
            );
            return;
        }

        // Derive accounts necessary to place the intial offer. We can bypass deriving these
        // accounts by posting the VAA before generating the `placeIniitialOfferTx`, but we
        // don't here to reduce complexity.
        const { fastVaaAccount, auction, fromRouterEndpoint, toRouterEndpoint } =
            getPlaceInitialOfferAccounts(
                matchingEngine,
                fetchedFastVaa.bytes,
                fetchedFastVaa.emitterChain,
                order.targetChain,
            );

        // Bail if the auction is already started.
        const isAuctionStarted = await connection
            .getAccountInfo(auction)
            .then((info) => info !== null);

        if (isAuctionStarted) {
            logicLogger.warn(`Auction already started, sequence=${fetchedFastVaa.sequence}`);
            return;
        }

        // Create the instructions to post the fast VAA if it hasn't been posted already.
        const isPosted = await connection
            .getAccountInfo(fastVaaAccount)
            .then((info) => info !== null);

        if (!isPosted) {
            logicLogger.debug(
                `Prepare verify signatures and post VAA, sequence=${fetchedFastVaa.sequence}`,
            );
            const preparedPostVaaTxs = await utils.preparePostVaaTxs(
                connection,
                cfg,
                matchingEngine,
                payer,
                fetchedFastVaa,
                { preflightCommitment: cfg.solanaCommitment() },
            );
            preparedTransactionQueue.push(...preparedPostVaaTxs);
        }

        logicLogger.debug(`Prepare initialize auction, sequence=${fetchedFastVaa.sequence}`);
        const initializeAuctionTx = await matchingEngine.placeInitialOfferTx(
            {
                payer: payer.publicKey,
                fastVaa: fastVaaAccount,
                auction,
                fromRouterEndpoint,
                toRouterEndpoint,
                totalDeposit,
            },
            order.maxFee,
            [payer],
            {
                computeUnits: cfg.initiateAuctionComputeUnits(),
                feeMicroLamports: 10,
                nonceAccount: cfg.solanaNonceAccount(),
            },
            {
                preflightCommitment: cfg.solanaCommitment(),
                skipPreflight: isPosted ? false : true,
            },
        );
        preparedTransactionQueue.push(initializeAuctionTx);

        // Done.
        await next();
    });

    logicLogger.debug("Listening");

    // Do it.
    await app.listen();
}

function isFeeHighEnough(
    fastOrder: FastMarketOrder,
    pricingParameters: utils.PricingParameters,
): { shouldPlaceOffer: boolean; fvWithEdge: bigint } {
    const precision = 10000;
    const bnPrecision = BigInt(precision);

    const fairValue =
        (fastOrder.amountIn * BigInt(pricingParameters.probability * precision)) / bnPrecision;
    const fairValueWithEdge =
        fairValue + (fairValue * BigInt(pricingParameters.edgePctOfFv * precision)) / bnPrecision;

    if (fairValueWithEdge > fastOrder.maxFee) {
        return { shouldPlaceOffer: false, fvWithEdge: fairValueWithEdge };
    } else {
        return { shouldPlaceOffer: true, fvWithEdge: fairValueWithEdge };
    }
}

interface PlaceInitialOfferAccounts {
    fastVaaAccount: PublicKey;
    auction: PublicKey;
    fromRouterEndpoint: PublicKey;
    toRouterEndpoint: PublicKey;
}

function getPlaceInitialOfferAccounts(
    matchingEngine: MatchingEngineProgram,
    fastVaaBytes: Uint8Array,
    fromChain: wormholeSdk.ChainId | number,
    toChain: wormholeSdk.ChainId | number,
): PlaceInitialOfferAccounts {
    const fastVaaAccount = derivePostedVaaKey(
        matchingEngine.coreBridgeProgramId(),
        wormholeSdk.parseVaa(fastVaaBytes).hash,
    );
    const auction = matchingEngine.auctionAddress(
        wormholeSdk.keccak256(wormholeSdk.parseVaa(fastVaaBytes).hash),
    );
    const fromRouterEndpoint = matchingEngine.routerEndpointAddress(fromChain);
    const toRouterEndpoint = matchingEngine.routerEndpointAddress(toChain);

    return {
        fastVaaAccount,
        auction,
        fromRouterEndpoint,
        toRouterEndpoint,
    };
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
