import { MessageCompiledInstruction, PublicKey } from "@solana/web3.js";
import * as winston from "winston";

const PLACE_INITIAL_OFFER_SELECTOR = Uint8Array.from([170, 227, 204, 195, 210, 9, 219, 220]);
const IMPROVE_OFFER_SELECTOR = Uint8Array.from([171, 112, 46, 172, 194, 135, 23, 102]);

export type QueuedOrderDetails = {
    auction: PublicKey;
    txSignature: string;
};

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
