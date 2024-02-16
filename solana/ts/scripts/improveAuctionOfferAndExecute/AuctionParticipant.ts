import { Connection, MessageCompiledInstruction, PublicKey } from "@solana/web3.js";
import * as winston from "winston";
import { AuctionUpdate, MatchingEngineProgram } from "../../src/matchingEngine";

const PLACE_INITIAL_OFFER_SELECTOR = Uint8Array.from([170, 227, 204, 195, 210, 9, 219, 220]);
const IMPROVE_OFFER_SELECTOR = Uint8Array.from([171, 112, 46, 172, 194, 135, 23, 102]);

export class AuctionParticipant {
    private _logger: winston.Logger;
    private _matchingEngine: MatchingEngineProgram;
    private _connection: Connection;

    private _recognizedTokenAccounts: PublicKey[];

    private _ourAuctions: Map<string, bigint>;

    constructor(
        matchingEngine: MatchingEngineProgram,
        recognizedTokenAccounts: PublicKey[],
        logger: winston.Logger,
    ) {
        this._logger = logger;
        this._matchingEngine = matchingEngine;
        this._connection = matchingEngine.program.provider.connection;

        this._recognizedTokenAccounts = recognizedTokenAccounts;

        this._ourAuctions = new Map();
    }

    async onAuctionUpdateCallback() {
        const logger = this._logger;
        const matchingEngine = this._matchingEngine;

        const connection = this._connection;
        if (connection.commitment !== undefined) {
            logger.info(`Connection established with "${connection.commitment}" commitment`);
        }

        const ourTokenAccounts = this._recognizedTokenAccounts;
        for (const ours of ourTokenAccounts) {
            logger.info(`Recognized token account: ${ours.toString()}`);
        }

        logger.info("Fetching active auction config");
        const { auctionConfigId } = await matchingEngine.fetchCustodian();
        const { parameters } = await matchingEngine.fetchAuctionConfig(auctionConfigId);
        logger.info(`Found auction config with ID: ${auctionConfigId.toString()}`);

        logger.info(
            `Listen to transaction logs from Matching Engine: ${matchingEngine.ID.toString()}`,
        );
        return async function (event: AuctionUpdate, slot: number, signature: string) {
            logger.debug(`Found signature: ${signature} at slot ${slot}. Fetching transaction.`);

            // Do we want to play?
            const { offerToken, amountIn, maxOfferPriceAllowed } = event;
            logger.debug(
                `Do we participate? offerToken: ${offerToken.toString()}, amountIn: ${amountIn.toString()}, maxOfferPriceAllowed: ${maxOfferPriceAllowed.toString()}`,
            );

            if (ourTokenAccounts.find((ours) => ours.equals(offerToken)) !== undefined) {
                logger.debug("I recognize this guy. Disregard?");
                // return;
            } else {
                logger.debug(`Let's play.`);
            }

            // TODO: save sigs to db and check if we've already processed this.

            // WARNING: When using get parsed transaction and there is a LUT involved,
            // const txMessage = await connection
            //     .getTransaction(signature, {
            //         maxSupportedTransactionVersion: 0,
            //     })
            //     .then((response) => response?.transaction.message);
            // if (txMessage === undefined) {
            //     logger.warn(`Failed to fetch transaction with ${signature}`);
            //     return;
            // }

            // const txPayer = txMessage.staticAccountKeys[0];
            // if (recognizedPayers.find((recognized) => recognized.equals(txPayer)) !== undefined) {
            //     logger.debug("I recognize a payer. Disregard?");
            //     // return;
            // } else {
            //     logger.debug(`Who is this? ${txPayer.toString()}`);
            // }

            // for (const ix of txMessage.compiledInstructions) {
            //     const offerAmount = getOfferAmount(ix, logger);
            //     if (offerAmount !== null) {
            //         const improveOfferBy = await matchingEngine.computeMinOfferDelta(
            //             offerAmount,
            //             parameters,
            //         );
            //         logger.debug(`Improve offer? ${offerAmount - improveOfferBy}`);
            //     }
            // }
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
