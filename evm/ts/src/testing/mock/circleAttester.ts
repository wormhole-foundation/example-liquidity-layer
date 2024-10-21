import { ethers } from "ethers-v5";
import { GUARDIAN_PRIVATE_KEY } from "../consts";

export type Attestation = {
    circleBridgeMessage: Buffer;
    circleAttestation: Buffer;
};

export class CircleAttester {
    attester: ethers.utils.SigningKey;

    constructor() {
        this.attester = new ethers.utils.SigningKey("0x" + GUARDIAN_PRIVATE_KEY);
    }

    createAttestation(message: Buffer | Uint8Array) {
        const signature = this.attester.signDigest(ethers.utils.keccak256(message));

        const attestation = Buffer.alloc(65);
        attestation.set(ethers.utils.arrayify(signature.r), 0);
        attestation.set(ethers.utils.arrayify(signature.s), 32);

        const recoveryId = signature.recoveryParam;
        attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, 64);

        return attestation;
    }
}
