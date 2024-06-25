import { ethers } from "ethers";
import { GUARDIAN_PRIVATE_KEY } from "../consts";
import { keccak256 } from "@wormhole-foundation/sdk-definitions";

export type Attestation = {
    circleBridgeMessage: Buffer;
    circleAttestation: Buffer;
};

export class CircleAttester {
    attester: ethers.SigningKey;

    constructor() {
        this.attester = new ethers.SigningKey("0x" + GUARDIAN_PRIVATE_KEY);
    }

    createAttestation(message: Buffer | Uint8Array) {
        const signature = this.attester.sign(keccak256(message));

        const attestation = Buffer.alloc(65);
        attestation.set(ethers.getBytes(signature.r), 0);
        attestation.set(ethers.getBytes(signature.s), 32);

        const recoveryId = signature.v;
        attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, 64);

        return attestation;
    }
}
