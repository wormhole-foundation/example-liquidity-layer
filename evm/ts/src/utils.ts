import { ChainId, toChain } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { ethers } from "ethers";
import { CoreBridgeLiquidityLayerMessage, MessageDecoder } from "./messages";

export function parseEvmEvents(
    txReceipt: ethers.TransactionReceipt,
    contractAddress: string,
    eventInterface: string,
) {
    let wormholeLogs: ethers.Result[] = [];
    for (const txLog of txReceipt.logs) {
        if (txLog.address === contractAddress) {
            try {
                const iface = new ethers.Interface([`event ${eventInterface}`]);
                const event = iface.parseLog(txLog)!.args;
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
    txReceipt: ethers.TransactionReceipt,
    contractAddress: string,
    eventInterface: string,
) {
    for (const txLog of txReceipt.logs) {
        if (txLog.address === contractAddress) {
            try {
                const iface = new ethers.Interface([`event ${eventInterface}`]);
                return iface.parseLog(txLog)!.args;
            } catch (e: any) {
                if (e.reason === "no matching event") {
                    continue;
                }
            }
        }
    }

    throw new Error("contract address not found");
}

export function bufferfy(value: number | ethers.BytesLike): Buffer {
    if (typeof value === "number") value = ethers.toQuantity(value);
    return Buffer.from(ethers.getBytes(value));
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
        txReceipt: ethers.TransactionReceipt,
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

        for (const pm of publishedMessages) {
            let {
                sender: evmEmitterAddress,
                sequence: ethersSequence,
                nonce,
                payload: payloadByteslike,
                consistencyLevel,
            } = pm;

            const emitterAddress = toUniversal(chain, evmEmitterAddress).toUint8Array();
            const sequence = BigInt(ethersSequence.toString());
            const encodedMessage = bufferfy(payloadByteslike);

            // Make sure the address is checksummed.
            evmEmitterAddress = ethers.getAddress(evmEmitterAddress);
            contractAddress = ethers.getAddress(contractAddress);

            if (evmEmitterAddress !== contractAddress) {
                throw new Error("Unrecognized emitter address.");
            }

            const message = {
                emitterAddress,
                sequence,
                nonce,
                consistencyLevel,
                message: MessageDecoder.decode(new Uint8Array(encodedMessage)),
            };

            if (message.message.header.wormholeCctp) {
                wormhole = message;
                circleMessage = bufferfy(
                    parseEvmEvent(txReceipt, circleTransmitterAddress, "MessageSent(bytes message)")
                        .message,
                );
            } else {
                // Handles FastFills and FastMarketOrders.
                if (message.message.body.fastMarketOrder !== undefined) {
                    fastMessage = message;
                } else {
                    // Override `wormhole` if it's a FastFill.
                    wormhole = message;
                }
            }
        }

        if (wormhole === undefined) {
            throw new Error("Wormhole message not found");
        }

        return new LiquidityLayerTransactionResult(wormhole, circleMessage, fastMessage);
    }
}
