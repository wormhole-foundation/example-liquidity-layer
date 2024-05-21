import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { PreparedTransaction } from "@wormhole-foundation/example-liquidity-layer-solana";
import { MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { FastMarketOrder } from "@wormhole-foundation/example-liquidity-layer-definitions";
import * as utils from ".";
import * as winston from "winston";
import { ChainId, toChainId } from "@wormhole-foundation/sdk-base";
import { VAA, deserialize, keccak256 } from "@wormhole-foundation/sdk-definitions";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";

export interface PlaceInitialOfferAccounts {
    fastVaaAccount: PublicKey;
    auction: PublicKey;
    fromRouterEndpoint: PublicKey;
    toRouterEndpoint: PublicKey;
}

function getPlaceInitialOfferAccounts(
    matchingEngine: MatchingEngineProgram,
    fastVaaBytes: Uint8Array,
    fromChain: ChainId | number,
    toChain: ChainId | number,
): PlaceInitialOfferAccounts {
    const vaa = deserialize("Uint8Array", fastVaaBytes);
    const doubleHash = keccak256(vaa.hash);
    const fastVaaAccount = coreUtils.derivePostedVaaKey(
        vaa.hash,
        matchingEngine.coreBridgeProgramId().toBuffer(),
    );
    const auction = matchingEngine.auctionAddress(doubleHash);
    const fromRouterEndpoint = matchingEngine.routerEndpointAddress(fromChain as ChainId);
    const toRouterEndpoint = matchingEngine.routerEndpointAddress(toChain as ChainId);

    return {
        fastVaaAccount,
        auction,
        fromRouterEndpoint,
        toRouterEndpoint,
    };
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

export async function handlePlaceInitialOffer(
    connection: Connection,
    cfg: utils.AppConfig,
    matchingEngine: MatchingEngineProgram,
    fastVaa: VAA,
    rawVaa: Uint8Array,
    order: FastMarketOrder,
    payer: Keypair,
    logicLogger: winston.Logger,
): Promise<PreparedTransaction[]> {
    const unproccessedTxns: PreparedTransaction[] = [];

    // Derive accounts necessary to place the intial offer. We can bypass deriving these
    // accounts by posting the VAA before generating the `placeIniitialOfferTx`, but we
    // don't here to reduce complexity.
    const { fastVaaAccount, auction, fromRouterEndpoint, toRouterEndpoint } =
        getPlaceInitialOfferAccounts(
            matchingEngine,
            rawVaa,
            toChainId(fastVaa.emitterChain),
            toChainId(order.targetChain),
        );

    // Bail if the auction is already started.
    const isAuctionStarted = await connection.getAccountInfo(auction).then((info) => info !== null);

    if (isAuctionStarted) {
        logicLogger.warn(`Auction already started, sequence=${fastVaa.sequence}`);
        return unproccessedTxns;
    }

    // See if the `maxFee` meets our minimum price threshold.
    const { shouldPlaceOffer, fvWithEdge } = isFeeHighEnough(
        order,
        cfg.pricingParameters(toChainId(fastVaa.emitterChain))!,
    );
    if (!shouldPlaceOffer) {
        logicLogger.warn(
            `Skipping sequence=${fastVaa.sequence} fee too low, maxFee=${order.maxFee}, fvWithEdge=${fvWithEdge}`,
        );
        return unproccessedTxns;
    }

    // See if we have enough funds to place the initial offer.
    const notionalDeposit = await matchingEngine.computeNotionalSecurityDeposit(
        order.amountIn,
        2, // TODO: Add this to config.
    );
    const totalDeposit = order.amountIn + order.maxFee + notionalDeposit;
    const isSufficient = utils.isBalanceSufficient(connection, payer.publicKey, totalDeposit);

    if (!isSufficient) {
        logicLogger.warn(
            `Insufficient balance to place initial offer, sequence=${fastVaa.sequence}`,
        );
        return unproccessedTxns;
    }

    // Create the instructions to post the fast VAA if it hasn't been posted already.
    const isPosted = await connection.getAccountInfo(fastVaaAccount).then((info) => info !== null);

    if (!isPosted) {
        logicLogger.debug(`Prepare verify signatures and post VAA, sequence=${fastVaa.sequence}`);
        const preparedPostVaaTxs = await utils.preparePostVaaTxs(
            connection,
            cfg,
            matchingEngine,
            payer,
            fastVaa,
            { commitment: cfg.solanaCommitment() },
        );
        unproccessedTxns.push(...preparedPostVaaTxs);
    }

    logicLogger.debug(
        `Prepare initialize auction, sequence=${fastVaa.sequence}, auction=${auction}`,
    );
    const initializeAuctionTx = await matchingEngine.placeInitialOfferTx(
        {
            payer: payer.publicKey,
            fastVaa: fastVaaAccount,
            auction,
            fromRouterEndpoint,
            toRouterEndpoint,
        },
        { offerPrice: order.maxFee, totalDeposit },
        [payer],
        {
            computeUnits: cfg.initiateAuctionComputeUnits(),
            feeMicroLamports: 10,
        },
        {
            commitment: cfg.solanaCommitment(),
            skipPreflight: isPosted ? false : true,
        },
    );
    unproccessedTxns.push(initializeAuctionTx);

    return unproccessedTxns;
}
