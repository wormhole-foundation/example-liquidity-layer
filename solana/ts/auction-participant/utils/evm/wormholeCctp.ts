import { ethers } from "ethers";
import * as winston from "winston";
import * as wormholeSdk from "@certusone/wormhole-sdk";
import fetch from "node-fetch";

const WORMHOLE_MESSAGE = new ethers.utils.Interface([
    "event LogMessagePublished(address indexed sender,uint64 sequence,uint32 nonce,bytes payload,uint8 consistencyLevel)",
]);

const CCTP_MESSAGE = new ethers.utils.Interface(["event MessageSent(bytes message)"]);

export async function unsafeFindAssociatedCctpMessageAndAttestation(
    rpc: string,
    cctpAttestationEndpoint: string,
    coreBridgeAddress: string,
    txHash: string,
    vaa: wormholeSdk.ParsedVaa,
    logger: winston.Logger,
): Promise<{ encodedCctpMessage: Buffer; cctpAttestation: Buffer }> {
    const { logs } = await new ethers.providers.StaticJsonRpcProvider(rpc).getTransactionReceipt(
        txHash,
    );

    const wormholeMessageIndex = findWormholeMessageIndex(logs, coreBridgeAddress, vaa, logger)!;

    // We make the assumption that the CCTP events precede the Wormhole
    // message that the Token Router publishes. We already checked the legitimacy
    // of this Wormhole message by knowing the emitter and that this message is
    // a slow order response.
    const encodedCctpMessage = ethers.utils.arrayify(
        CCTP_MESSAGE.parseLog(logs[wormholeMessageIndex - 2]).args.message,
    );
    const cctpAttestation = await fetchCctpAttestation(
        cctpAttestationEndpoint,
        encodedCctpMessage,
        logger,
    );
    return {
        encodedCctpMessage: Buffer.from(encodedCctpMessage),
        cctpAttestation: Buffer.from(cctpAttestation),
    };
}

function findWormholeMessageIndex(
    logs: ethers.providers.Log[],
    coreBridgeAddress: string,
    vaa: wormholeSdk.ParsedVaa,
    logger: winston.Logger,
): number | undefined {
    for (let i = 0; i < logs.length; ++i) {
        const log = logs[i];
        if (log.address != coreBridgeAddress) {
            continue;
        }
        const { sequence } = WORMHOLE_MESSAGE.parseLog(log).args;
        if (sequence.toString() == vaa.sequence.toString()) {
            return i;
        }
    }

    logger.error(
        `Could not find wormhole message for VAA: chain=${vaa.emitterChain}, sequence=${vaa.sequence}`,
    );
}

async function fetchCctpAttestation(
    cctpAttestationEndpoint: string,
    encodedCctpMessage: Uint8Array,
    logger: winston.Logger,
): Promise<Uint8Array> {
    const attestationRequest = `${cctpAttestationEndpoint}/attestations/${ethers.utils.keccak256(
        encodedCctpMessage,
    )}`;
    logger.info(`Attempting: ${attestationRequest}`);

    let attestationResponse: { status?: string; attestation?: string } = {};
    let j = 1;
    while (
        attestationResponse.status != "complete" ||
        attestationResponse.attestation == undefined
    ) {
        logger.debug(`Attempting to fetch attestation, iteration=${j}`);

        const response = await fetch(attestationRequest);
        attestationResponse = await response.json();

        await new Promise((r) => setTimeout(r, j * 2000));
        ++j;
    }

    const { attestation } = attestationResponse;
    logger.debug(`Found attestation: ${attestation}`);

    return ethers.utils.arrayify(attestation!);
}
