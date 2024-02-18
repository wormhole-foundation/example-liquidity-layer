import {
    BlockhashWithExpiryBlockHeight,
    Connection,
    Keypair,
    MessageCompiledInstruction,
    PublicKey,
} from "@solana/web3.js";
import * as winston from "winston";
import { AuctionUpdate, MatchingEngineProgram } from "../../src/matchingEngine";
import * as utils from "../utils";

const PLACE_INITIAL_OFFER_SELECTOR = Uint8Array.from([170, 227, 204, 195, 210, 9, 219, 220]);
const IMPROVE_OFFER_SELECTOR = Uint8Array.from([171, 112, 46, 172, 194, 135, 23, 102]);

export type QueuedOrderDetails = {
    auction: PublicKey;
    txSignature: string;
};

export class AuctionParticipant {
    private _logger: winston.Logger;
    private _matchingEngine: MatchingEngineProgram;
    private _connection: Connection;
    private _offerAuthority: Keypair;

    private _recognizedTokenAccounts: PublicKey[];

    private _slotOrders: Map<number, QueuedOrderDetails[]>;

    private _latestBlockhash?: BlockhashWithExpiryBlockHeight;
    private _updatedNoise: number;

    constructor(
        matchingEngine: MatchingEngineProgram,
        offerAuthority: Keypair,
        recognizedTokenAccounts: PublicKey[],
        logger: winston.Logger,
    ) {
        this._logger = logger;
        this._matchingEngine = matchingEngine;
        this._connection = matchingEngine.program.provider.connection;
        this._offerAuthority = offerAuthority;

        this._recognizedTokenAccounts = recognizedTokenAccounts;

        this._slotOrders = new Map();

        this._updatedNoise = 0;
    }

    get slotOrders() {
        return this._slotOrders;
    }

    updateLatestBlockhash(update: BlockhashWithExpiryBlockHeight) {
        this._latestBlockhash = update;
        this._updatedNoise = 0;
    }

    cachedBlockhash(): BlockhashWithExpiryBlockHeight | undefined {
        return this._latestBlockhash;
    }

    adjustedFeeMicroLamports(feeMicroLamports: number): number {
        return feeMicroLamports + this._updatedNoise++;
    }

    async onAuctionUpdateCallback() {
        const logger = this._logger;
        const matchingEngine = this._matchingEngine;
        const offerAuthority = this._offerAuthority;

        const connection = this._connection;
        if (connection.commitment !== undefined) {
            logger.info(`Connection established with "${connection.commitment}" commitment`);
        }

        await connection.getLatestBlockhash("finalized").then((blockhash) => {
            this.updateLatestBlockhash(blockhash);
        });

        const ourTokenAccounts = this._recognizedTokenAccounts;
        for (const ours of ourTokenAccounts) {
            logger.info(`Recognized token account: ${ours.toString()}`);
        }

        logger.info("Fetching active auction config");
        const { auctionConfigId } = await matchingEngine.fetchCustodian();
        logger.info(`Auction config ID: ${auctionConfigId.toString()}`);
        //const { parameters } = await matchingEngine.fetchAuctionConfig(auctionConfigId);

        const slotOrders = this._slotOrders;

        // TODO: add to config
        // 0.42069 lamports per compute unit.
        const baseFeeLamports = 42069;
        // 0.0001 lamports per amount in (e.g. 10 lamports per compute unit for 10,000 USDC).
        const scaleAmountFeeLamports = 100;

        const cachedBlockhash = this.cachedBlockhash;
        const adjustedFeeMicroLamports = this.adjustedFeeMicroLamports;

        logger.info(
            `Listen to transaction logs from Matching Engine: ${matchingEngine.ID.toString()}`,
        );
        return async function (event: AuctionUpdate, slot: number, signature: string) {
            logger.debug(`Found auction update: ${signature} at slot ${slot}.`);

            // Do we want to play?
            const {
                auction,
                vaa,
                offerToken,
                endSlot,
                amountIn,
                totalDeposit,
                maxOfferPriceAllowed,
            } = event;
            logger.debug(
                `Do we participate? offerToken: ${offerToken.toString()}, amountIn: ${amountIn.toString()}, maxOfferPriceAllowed: ${maxOfferPriceAllowed.toString()}`,
            );

            if (vaa === null) {
                logger.debug("Improve offer");
            } else {
                logger.debug("Place initial offer");
            }

            if (ourTokenAccounts.find((ours) => ours.equals(offerToken)) !== undefined) {
                logger.debug("I recognize this guy. Disregard?");
            } else {
                logger.debug(`Let's play.`);

                if (endSlot.lten(slot)) {
                    logger.debug("Skipping");
                    return;
                }

                // TODO: do something smarter than this.
                const offerPrice = maxOfferPriceAllowed;

                const preppedTx = await matchingEngine.improveOfferTx(
                    {
                        offerAuthority: offerAuthority.publicKey,
                        auction,
                        auctionConfig: matchingEngine.auctionConfigAddress(auctionConfigId),
                        bestOfferToken: offerToken,
                    },
                    { offerPrice, totalDeposit },
                    [offerAuthority],
                    {
                        feeMicroLamports: adjustedFeeMicroLamports(
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
                utils.sendTx(connection, preppedTx, logger, cachedBlockhash());

                const auctions = slotOrders.get(slot);
                if (auctions === undefined) {
                    slotOrders.set(slot, [{ auction, txSignature: signature }]);
                } else {
                    auctions.push({ auction, txSignature: signature });
                }
            }
        };
    }
}

function getOfferAmount(ix: MessageCompiledInstruction, logger: winston.Logger) {
    const data = Buffer.from(ix.data);

    const discriminator = data.subarray(0, 8);
    if (discriminator.equals(PLACE_INITIAL_OFFER_SELECTOR)) {
        const offerAmount = data.readBigUInt64LE(8);
        logger.debug(`Found initial offer for ${offerAmount}`);
        return offerAmount;
    } else if (discriminator.equals(IMPROVE_OFFER_SELECTOR)) {
        const offerAmount = data.readBigUInt64LE(8);
        logger.debug(`Found improved offer for ${offerAmount}`);
        return offerAmount;
    } else {
        return null;
    }
}
