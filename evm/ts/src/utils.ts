import { ethers } from "ethers";
import { CoreBridgeLiquidityLayerMessage, MessageDecoder } from "./messages";
import {
    ChainId,
    ChainName,
    coalesceChainName,
    tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";

export function parseEvmEvent(
    txReceipt: ethers.ContractReceipt,
    contractAddress: string,
    eventInterface: string
) {
    for (const txLog of txReceipt.logs) {
        if (txLog.address === contractAddress) {
            const iface = new ethers.utils.Interface([`event ${eventInterface}`]);
            return iface.parseLog(txLog).args;
        }
    }

    throw new Error("contract address not found");
}

export function bufferfy(value: number | ethers.utils.BytesLike | ethers.utils.Hexable): Buffer {
    return Buffer.from(ethers.utils.arrayify(value));
}

export function unsafeChainName(value: number): ChainName {
    return coalesceChainName(value as ChainId);
}

export const CIRCLE_DOMAINS = [0, 1, 2, 3, 6] as const;
export type CircleDomain = (typeof CIRCLE_DOMAINS)[number];

export function tryCircleDomain(value: number): CircleDomain {
    if (CIRCLE_DOMAINS.includes(value as any)) {
        return value as CircleDomain;
    } else {
        throw new Error("unrecognized domain");
    }
}

export function circleDomainToChain(domain: CircleDomain): ChainName {
    switch (domain) {
        case 0: {
            return "ethereum";
        }
        case 1: {
            return "avalanche";
        }
        case 2: {
            return "optimism";
        }
        case 3: {
            return "arbitrum";
        }
        case 6: {
            return "base";
        }
        default: {
            throw new Error("unrecognized domain");
        }
    }
}

export type LiquidityLayerObservation = {
    emitterAddress: Uint8Array;
    sequence: bigint;
    nonce: number;
    consistencyLevel: number;
    message: CoreBridgeLiquidityLayerMessage;
};

export class LiquidityLayerTransactionResult {
    wormhole: LiquidityLayerObservation;
    circleMessage?: Buffer;

    constructor(observation: LiquidityLayerObservation, circleMessage?: Buffer) {
        this.wormhole = observation;
        this.circleMessage = circleMessage;
    }

    targetChain() {
        const header = this.wormhole.message.header;
        if (header.wormholeCctp !== undefined) {
            return circleDomainToChain(tryCircleDomain(header.wormholeCctp?.targetDomain));
        } else {
            throw new Error("Bad liquidity layer header");
        }
    }

    static fromEthersTransactionReceipt(
        chain: ChainId | ChainName,
        coreBridgeAddress: string,
        wormholeCctpAddress: string,
        txReceipt: ethers.ContractReceipt,
        circleTransmitterAddress?: string
    ) {
        // First get Wormhole message.
        const logMessagePublished = parseEvmEvent(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"
        );
        const {
            sender: evmEmitterAddress,
            sequence: ethersSequence,
            nonce,
            payload: payloadByteslike,
            consistencyLevel,
        } = logMessagePublished;

        const emitterAddress = Buffer.from(tryNativeToUint8Array(evmEmitterAddress, chain));
        const sequence = BigInt(ethersSequence.toString());
        const encodedMessage = bufferfy(payloadByteslike);

        if (evmEmitterAddress === wormholeCctpAddress) {
            // This should never happen.
            if (circleTransmitterAddress === undefined) {
                throw new Error("Circle transmitter address is undefined");
            }

            const wormhole = {
                emitterAddress,
                sequence,
                nonce,
                consistencyLevel,
                message: MessageDecoder.unsafeDecodeWormholeCctpPayload(encodedMessage),
            };

            const circleMessage = bufferfy(
                parseEvmEvent(txReceipt, circleTransmitterAddress, "MessageSent(bytes message)")
                    .message
            );
            return new LiquidityLayerTransactionResult(wormhole, circleMessage);
        } else {
            throw new Error("Unrecognized emitter address.");
        }
    }
}
