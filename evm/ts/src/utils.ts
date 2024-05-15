import { ethers } from "ethers";
import { CCTP_DEPOSIT_PAYLOAD, CoreBridgeLiquidityLayerMessage, MessageDecoder } from "./messages";
import { ChainId, toChain, toUniversal } from "@wormhole-foundation/sdk";

export function parseEvmEvents(
    txReceipt: ethers.ContractReceipt,
    contractAddress: string,
    eventInterface: string,
) {
    let wormholeLogs: ethers.utils.Result[] = [];
    for (const txLog of txReceipt.logs) {
        if (txLog.address === contractAddress) {
            const iface = new ethers.utils.Interface([`event ${eventInterface}`]);
            try {
                const iface = new ethers.utils.Interface([`event ${eventInterface}`]);
                const event = iface.parseLog(txLog).args;
                wormholeLogs.push(event);
            } catch (e: any) {
                if (e.reason === "no matching event") {
                    continue;
                }
            }
        }
    }
    if (wormholeLogs.length === 0) {
        throw new Error("contract address not found");
    }

    return wormholeLogs;
}

export function parseEvmEvent(
    txReceipt: ethers.ContractReceipt,
    contractAddress: string,
    eventInterface: string,
) {
    for (const txLog of txReceipt.logs) {
        if (txLog.address === contractAddress) {
            try {
                const iface = new ethers.utils.Interface([`event ${eventInterface}`]);
                return iface.parseLog(txLog).args;
            } catch (e: any) {
                if (e.reason === "no matching event") {
                    continue;
                }
            }
        }
    }

    throw new Error("contract address not found");
}

export function bufferfy(value: number | ethers.utils.BytesLike | ethers.utils.Hexable): Buffer {
    return Buffer.from(ethers.utils.arrayify(value));
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
    fastMessage?: LiquidityLayerObservation;

    constructor(
        observation: LiquidityLayerObservation,
        circleMessage?: Buffer,
        fastMessage?: LiquidityLayerObservation,
    ) {
        this.wormhole = observation;
        this.circleMessage = circleMessage;
        this.fastMessage = fastMessage;
    }

    static fromEthersTransactionReceipt(
        chainId: ChainId,
        contractAddress: string,
        coreBridgeAddress: string,
        txReceipt: ethers.ContractReceipt,
        circleTransmitterAddress: string,
    ) {
        const chain = toChain(chainId);
        // First get Wormhole message.
        const publishedMessages = parseEvmEvents(
            txReceipt,
            coreBridgeAddress,
            "LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)",
        );

        let circleMessage: Buffer | undefined;
        let fastMessage: LiquidityLayerObservation | undefined;
        let wormhole: LiquidityLayerObservation | undefined;

        for (const message of publishedMessages) {
            let {
                sender: evmEmitterAddress,
                sequence: ethersSequence,
                nonce,
                payload: payloadByteslike,
                consistencyLevel,
            } = message;

            const emitterAddress = toUniversal(chain, evmEmitterAddress).toUint8Array();
            const sequence = BigInt(ethersSequence.toString());
            const encodedMessage = bufferfy(payloadByteslike);

            const payloadId = encodedMessage.readUInt8(0);

            // Make sure the address is checksummed.
            evmEmitterAddress = ethers.utils.getAddress(evmEmitterAddress);
            contractAddress = ethers.utils.getAddress(contractAddress);

            if (evmEmitterAddress == contractAddress) {
                if (payloadId == CCTP_DEPOSIT_PAYLOAD) {
                    wormhole = {
                        emitterAddress,
                        sequence,
                        nonce,
                        consistencyLevel,
                        message: MessageDecoder.unsafeDecodeWormholeCctpPayload(encodedMessage),
                    };

                    circleMessage = bufferfy(
                        parseEvmEvent(
                            txReceipt,
                            circleTransmitterAddress,
                            "MessageSent(bytes message)",
                        ).message,
                    );
                } else {
                    // Handles FastFills and FastMarketOrders.
                    const message = {
                        emitterAddress,
                        sequence,
                        nonce,
                        consistencyLevel,
                        message: MessageDecoder.unsafeDecodeFastPayload(encodedMessage),
                    };

                    // Override `wormhole` if it's a FastFill.
                    if (message.message.body.fastMarketOrder !== undefined) {
                        fastMessage = message;
                    } else {
                        wormhole = message;
                    }
                }
            } else {
                throw new Error("Unrecognized emitter address.");
            }
        }

        if (wormhole === undefined) {
            throw new Error("Wormhole message not found");
        }

        return new LiquidityLayerTransactionResult(wormhole, circleMessage, fastMessage);
    }
}
