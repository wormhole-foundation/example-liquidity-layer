import { BlockhashWithExpiryBlockHeight, Connection } from "@solana/web3.js";
import * as winston from "winston";

export class CachedBlockhash {
    private _cached?: BlockhashWithExpiryBlockHeight;
    private _noise: number;

    private constructor() {
        this._noise = 0;
    }

    static async initialize(connection: Connection) {
        const out = new CachedBlockhash();
        await connection.getLatestBlockhash("finalized").then((blockhash) => {
            out.update(blockhash);
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
        if (slot && logger !== undefined) {
            logger.debug(`Updated blockhash: ${fetched.blockhash} (slot ${slot})`);
        }
        this._cached = fetched;
        this._noise = 0;
    }

    // This allows for unique signatures for each transactions.
    addNoise(value: number) {
        return value + this._noise++;
    }
}
