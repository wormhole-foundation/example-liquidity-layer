import { ChainName } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { EvmObserver } from ".";
import { ICircleIntegration__factory, parseEvmEvent } from "../../../src";
import { GUARDIAN_PRIVATE_KEY } from "../consts";

export type Attestation = {
  circleBridgeMessage: Buffer;
  circleAttestation: Buffer;
};

export class CircleAttester implements EvmObserver<Attestation> {
  wormholeCctpAddress: string;
  attester: ethers.utils.SigningKey;

  constructor(wormholeCctpAddress: string) {
    this.wormholeCctpAddress = wormholeCctpAddress;
    this.attester = new ethers.utils.SigningKey("0x" + GUARDIAN_PRIVATE_KEY);
  }

  async observeEvm(
    provider: ethers.providers.Provider,
    _chain: ChainName,
    txReceipt: ethers.ContractReceipt
  ) {
    const circleTransmitterAddress = await ICircleIntegration__factory.connect(
      this.wormholeCctpAddress,
      provider
    ).circleTransmitter();
    const message = ethers.utils.arrayify(
      parseEvmEvent(
        txReceipt,
        circleTransmitterAddress,
        "MessageSent(bytes message)"
      ).message
    );

    const signature = this.attester.signDigest(ethers.utils.keccak256(message));

    const attestation = Buffer.alloc(65);
    attestation.set(ethers.utils.arrayify(signature.r), 0);
    attestation.set(ethers.utils.arrayify(signature.s), 32);

    const recoveryId = signature.recoveryParam;
    attestation.writeUInt8(recoveryId < 27 ? recoveryId + 27 : recoveryId, 64);

    return {
      circleBridgeMessage: Buffer.from(message),
      circleAttestation: attestation,
    };
  }
}
