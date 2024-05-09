export * from "./Custodian";
export * from "./PreparedFill";
export * from "./PreparedOrder";

import { utils } from "@wormhole-foundation/sdk-solana";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export function deriveCoreMessageKey(programId: PublicKey, payer: PublicKey, sequence: BN) {
    return utils.deriveAddress(
        [Buffer.from("msg"), payer.toBuffer(), sequence.toBuffer()],
        programId,
    );
}
