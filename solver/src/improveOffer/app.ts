import { Keypair, PublicKey } from "@solana/web3.js";
import "dotenv/config";
import * as fs from "fs";
import winston from "winston";
import { Uint64, uint64ToBigInt } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import {
    AuctionUpdated,
    MatchingEngineProgram,
} from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { CachedBlockhash, OfferToken } from "../containers";
import * as utils from "../utils";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

main(process.argv);

async function main(argv: string[]) {
    const cfgJson = JSON.parse(fs.readFileSync(argv[2], "utf-8"));
    const cfg = new utils.AppConfig(cfgJson);

    const logger = utils.defaultLogger({ label: "auction", level: "debug" });
    logger.info("Start logging");

    const connection = cfg.solanaConnection();

    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }

    // We play here.
    matchingEngine.onAuctionUpdated(
        await onAuctionUpdateCallback(
            matchingEngine,
            cfg,
            Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64")),
            logger,
        ),
    );
}

export async function onAuctionUpdateCallback(
    matchingEngine: MatchingEngineProgram,
    cfg: utils.AppConfig,
    participant: Keypair,
    logger: winston.Logger,
) {
    const connection = matchingEngine.program.provider.connection;
    const cachedBlockhash = await CachedBlockhash.initialize(
        connection,
        32, // slots
        "finalized",
        logger,
    );

    // Set up token account container.
    const offerToken = await OfferToken.initialize(matchingEngine, participant, logger);

    // Account for recognized token accounts so we do not offer against "ourselves".
    const ourTokenAccounts = Array.from(cfg.recognizedTokenAccounts());
    if (ourTokenAccounts.find((ours) => ours.equals(offerToken.address)) === undefined) {
        ourTokenAccounts.push(offerToken.address);
    }
    for (const ours of ourTokenAccounts) {
        logger.info(`Recognized token account: ${ours.toString()}`);
    }

    // TODO: add to config
    // 0.42069 lamports per compute unit.
    const baseFeeLamports = 42069;
    // 0.0001 lamports per amount in (e.g. 10 lamports per compute unit for 10,000 USDC).
    const scaleAmountFeeLamports = 100;

    logger.info(`Matching Engine: ${matchingEngine.ID.toString()}`);
    return async function (event: AuctionUpdated, slot: number, signature: string) {
        // Do we want to play?
        const {
            configId,
            auction,
            vaa,
            sourceChain,
            bestOfferToken,
            tokenBalanceBefore,
            endSlot,
            amountIn,
            totalDeposit,
            maxOfferPriceAllowed,
        } = event;

        const pricingParams = cfg.pricingParameters(sourceChain);
        if (pricingParams === null) {
            logger.error(`No pricing parameters found for source chain: ${sourceChain}`);
            return;
        }

        if (ourTokenAccounts.find((ours) => ours.equals(bestOfferToken)) !== undefined) {
            const tokenBalanceAfter = tokenBalanceBefore.sub(totalDeposit);

            if (bestOfferToken.equals(offerToken.address)) {
                offerToken.updateBalance(tokenBalanceAfter, { logger, signature });
            }

            // Done.
            return;
        }

        // We cannot participate for any participation at this point.
        if (endSlot.lten(slot)) {
            logger.debug(`Skipping ended auction: ${auction.toString()}`);
            return;
        }

        logger.debug(
            `Found ${
                vaa !== null ? "initial" : "improved"
            } auction: ${auction.toString()}, source chain: ${sourceChain}, slot: ${slot}, end slot: ${endSlot}, tx: ${signature}`,
        );

        if (shouldImproveOffer(amountIn, maxOfferPriceAllowed, pricingParams)) {
            const preppedTx = await matchingEngine.improveOfferTx(
                {
                    participant: offerToken.authority.publicKey,
                    auction,
                    auctionConfig: matchingEngine.auctionConfigAddress(configId),
                    bestOfferToken,
                },
                { offerPrice: maxOfferPriceAllowed, totalDeposit },
                [offerToken.authority],
                {
                    feeMicroLamports: cachedBlockhash.addNoise(
                        baseFeeLamports +
                            scaleAmountFeeLamports * amountIn.divn(1_000_000).toNumber(),
                    ),
                    computeUnits: 50_000,
                },
                {
                    skipPreflight: true,
                },
            );

            // Attempt to send without blocking.
            utils.sendTx(connection, preppedTx, logger, cachedBlockhash.latest);
        } else {
            logger.debug(`Skipping too low offer: ${maxOfferPriceAllowed.toString()}`);
        }
    };
}

function shouldImproveOffer(
    amountIn: Uint64,
    maxOfferPriceAllowed: Uint64,
    pricingParameters: utils.PricingParameters,
): boolean {
    const PRECISION = 10000n;

    const fairValue =
        (uint64ToBigInt(amountIn) * BigInt(pricingParameters.probability * Number(PRECISION))) /
        PRECISION;
    const fairValueWithEdge =
        fairValue +
        (fairValue * BigInt(pricingParameters.edgePctOfFv * Number(PRECISION))) / PRECISION;

    return fairValueWithEdge <= uint64ToBigInt(maxOfferPriceAllowed);
}
