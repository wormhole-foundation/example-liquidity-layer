import { PublicKey } from "@solana/web3.js";
import { AuctionSettled, AuctionUpdate, MatchingEngineProgram } from "../../src/matchingEngine";
import { CachedBlockhash, OfferToken } from "./containers";
import * as winston from "winston";
import * as utils from "../utils";

export function onAuctionSettledCallback(offerToken: OfferToken, logger: winston.Logger) {
    return function (event: AuctionSettled, _slot: number, signature: string) {
        const { bestOfferToken, tokenBalanceAfter } = event;

        if (bestOfferToken.equals(offerToken.address)) {
            offerToken.updateBalance(tokenBalanceAfter, logger, signature);
        }
    };
}

export async function onAuctionUpdateCallback(
    matchingEngine: MatchingEngineProgram,
    offerToken: OfferToken,
    cachedBlockhash: CachedBlockhash,
    recognizedTokenAccounts: Readonly<PublicKey[]>,
    logger: winston.Logger,
) {
    const connection = matchingEngine.program.provider.connection;

    const ourTokenAccounts = [...recognizedTokenAccounts];
    if (ourTokenAccounts.find((ours) => ours.equals(offerToken.address)) === undefined) {
        ourTokenAccounts.push(offerToken.address);
    }
    for (const ours of ourTokenAccounts) {
        logger.info(`Recognized token account: ${ours.toString()}`);
    }

    logger.info("Fetching active auction config");
    const { auctionConfigId } = await matchingEngine.fetchCustodian();
    logger.info(`Auction config ID: ${auctionConfigId.toString()}`);
    //const { parameters } = await matchingEngine.fetchAuctionConfig(auctionConfigId);

    // TODO: add to config
    // 0.42069 lamports per compute unit.
    const baseFeeLamports = 42069;
    // 0.0001 lamports per amount in (e.g. 10 lamports per compute unit for 10,000 USDC).
    const scaleAmountFeeLamports = 100;

    logger.info(`Listen to transaction logs from Matching Engine: ${matchingEngine.ID.toString()}`);
    return async function (event: AuctionUpdate, slot: number, signature: string) {
        // Do we want to play?
        const {
            auction,
            vaa,
            bestOfferToken,
            tokenBalanceBefore,
            endSlot,
            amountIn,
            totalDeposit,
            maxOfferPriceAllowed,
        } = event;

        if (vaa === null) {
            logger.debug("Improve offer");
        } else {
            logger.debug("Place initial offer");
        }

        if (ourTokenAccounts.find((ours) => ours.equals(bestOfferToken)) !== undefined) {
            const tokenBalanceAfter = tokenBalanceBefore.add(totalDeposit);

            if (bestOfferToken.equals(offerToken.address)) {
                offerToken.updateBalance(tokenBalanceAfter, logger, signature);
            }

            // Done.
            return;
        }

        // We cannot participate for any participation at this point.
        if (endSlot.lten(slot)) {
            return;
        }

        logger.debug(
            `Let's play in auction ${auction.toString()} from tx ${signature} (slot ${slot}).`,
        );

        // TODO: do something smarter than this.
        const offerPrice = maxOfferPriceAllowed;

        const preppedTx = await matchingEngine.improveOfferTx(
            {
                offerAuthority: offerToken.authority.publicKey,
                auction,
                auctionConfig: matchingEngine.auctionConfigAddress(auctionConfigId),
                bestOfferToken: offerToken.address,
            },
            { offerPrice, totalDeposit },
            [offerToken.authority],
            {
                feeMicroLamports: cachedBlockhash.addNoise(
                    baseFeeLamports + scaleAmountFeeLamports * amountIn.divn(1_000_000).toNumber(),
                ),
                computeUnits: 50_000,
            },
            {
                skipPreflight: true,
            },
        );

        // Attempt to send without blocking.
        utils.sendTx(connection, preppedTx, logger, cachedBlockhash.latest);
    };
}
