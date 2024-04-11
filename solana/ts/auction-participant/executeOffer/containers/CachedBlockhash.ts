import { BlockhashWithExpiryBlockHeight, Commitment, Connection } from "@solana/web3.js";
import * as winston from "winston";

export class CachedBlockhash {
    private _cached?: BlockhashWithExpiryBlockHeight;
    private _noise: number;

    private constructor() {
        this._noise = 0;
    }

    static async initialize(
        connection: Connection,
        updateBlockhashFrequency: number,
        commitment: Commitment,
        logger: winston.Logger,
    ) {
        const out = new CachedBlockhash();
        await connection.getLatestBlockhash(commitment).then((blockhash) => {
            out.update(blockhash, { logger });
        });

        connection.onSlotChange(async (info) => {
            const { slot } = info;

            // Update the latest blockhash every `updateBlockhashFrequency` slots.
            if (slot % updateBlockhashFrequency == 0) {
                // No need to block. We'll just update the latest blockhash and use it when needed.
                connection
                    .getLatestBlockhash(commitment)
                    .then((blockhash) => out.update(blockhash, { logger, slot }));
            }
        });

        return out;
    }

    get latest(): BlockhashWithExpiryBlockHeight | undefined {
        return this._cached;
    }

    update(
        fetched: BlockhashWithExpiryBlockHeight,
        opts: { logger?: winston.Logger; slot?: number } = {},
    ) {
        const { logger, slot } = opts;
        if (logger) {
            if (slot) {
                logger.debug(`Update blockhash: ${fetched.blockhash}, slot: ${slot}`);
            } else {
                logger.debug(`Update blockhash: ${fetched.blockhash}`);
            }
        }
        this._cached = fetched;
        this._noise = 0;
    }

    // This allows for unique signatures for each transactions.
    addNoise(value: number) {
        return value + this._noise++;
    }
}
