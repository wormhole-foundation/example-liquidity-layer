import { Connection, Context, Logs, MessageCompiledInstruction, PublicKey } from "@solana/web3.js";
import * as winston from "winston";
import { MatchingEngineProgram } from "../../src/matchingEngine";

const PLACE_INITIAL_OFFER_SELECTOR = Uint8Array.from([170, 227, 204, 195, 210, 9, 219, 220]);
const IMPROVE_OFFER_SELECTOR = Uint8Array.from([171, 112, 46, 172, 194, 135, 23, 102]);

export class AuctionParticipant {
    private _logger: winston.Logger;
    private _matchingEngine: MatchingEngineProgram;
    private _connection: Connection;

    private _recognizedPayers: PublicKey[];

    private _ourAuctions: Map<string, bigint>;

    constructor(
        matchingEngine: MatchingEngineProgram,
        recognizedPayers: string[],
        logger: winston.Logger,
    ) {
        this._logger = logger;
        this._matchingEngine = matchingEngine;
        this._connection = matchingEngine.program.provider.connection;

        this._recognizedPayers = recognizedPayers.map((keyInit) => new PublicKey(keyInit));

        this._ourAuctions = new Map();
    }

    async onLogsCallback() {
        const logger = this._logger;
        const matchingEngine = this._matchingEngine;

        const connection = this._connection;
        if (connection.commitment !== undefined) {
            logger.info(`Connection established with "${connection.commitment}" commitment`);
        }

        const recognizedPayers = this._recognizedPayers;
        for (const recognized of recognizedPayers) {
            logger.info(`Recognized payer: ${recognized.toString()}`);
        }

        logger.info("Fetching active auction config");
        const { auctionConfigId } = await matchingEngine.fetchCustodian();
        const { parameters } = await matchingEngine.fetchAuctionConfig(auctionConfigId);
        logger.info(`Found auction config with ID: ${auctionConfigId.toString()}`);

        logger.info(
            `Listen to transaction logs from Matching Engine: ${matchingEngine.ID.toString()}`,
        );
        return async function (logs: Logs, ctx: Context) {
            if (logs.err !== null) {
                return;
            }

            logger.debug(
                `Found signature: ${logs.signature} at slot ${ctx.slot}. Fetching transaction.`,
            );

            // TODO: save sigs to db and check if we've already processed this.

            // WARNING: When using get parsed transaction and there is a LUT involved,
            const txMessage = await connection
                .getTransaction(logs.signature, {
                    maxSupportedTransactionVersion: 0,
                })
                .then((response) => response?.transaction.message);
            if (txMessage === undefined) {
                logger.warn(`Failed to fetch transaction with ${logs.signature}`);
                return;
            }

            const txPayer = txMessage.staticAccountKeys[0];
            if (recognizedPayers.find((recognized) => recognized.equals(txPayer)) !== undefined) {
                logger.debug("I recognize a payer. Disregard?");
                // return;
            } else {
                logger.debug(`Who is this? ${txPayer.toString()}`);
            }

            for (const ix of txMessage.compiledInstructions) {
                const offerAmount = getOfferAmount(ix, logger);
                if (offerAmount !== null) {
                    const improveOfferBy = await matchingEngine.computeMinOfferDelta(
                        offerAmount,
                        parameters,
                    );
                    logger.debug(`Improve offer? ${offerAmount - improveOfferBy}`);
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
