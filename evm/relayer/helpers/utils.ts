import { Implementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { MessageDecoder } from "../../ts/src/";
import { WebSocketProvider } from "./websocket";
import { ethers } from "ethers";
import { RelayerConfig } from "./config";
import { ChainId, getEmitterAddressEth, getSignedVAAWithRetry } from "@certusone/wormhole-sdk";
import { EvmMatchingEngine } from "../../ts/src/";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import { TESTNET_GUARDIAN_RPC, CIRCLE_BURN_MESSAGE_TOPIC } from "../helpers/consts";

import { AxiosResponse } from "axios";
const axios = require("axios"); // import breaks

export function wormholeContract(address: string, signer: ethers.Signer): ethers.Contract {
    return Implementation__factory.connect(address, signer);
}

export async function getSignedVaa(
    fromChain: ChainId,
    _sender: string,
    sequence: ethers.BigNumberish
): Promise<Uint8Array> {
    // Fetch the signed VAA from the guardians.
    const { vaaBytes } = await getSignedVAAWithRetry(
        TESTNET_GUARDIAN_RPC,
        fromChain,
        getEmitterAddressEth(_sender),
        sequence.toString(),
        {
            transport: NodeHttpTransport(),
        }
    );

    return vaaBytes;
}

export function getChainId(config: RelayerConfig, address: string): ChainId | null {
    for (let router of Object.values(config.routers)) {
        if (
            router.cctp == ethers.utils.getAddress(address) ||
            router.router == ethers.utils.getAddress(address)
        ) {
            return Number(router.chain) as ChainId;
        }
    }
    return null;
}

export function getCctpEmitterFromConfig(config: RelayerConfig, chain: ChainId): string | null {
    return Object.values(config.routers).find((router) => router.chain == chain)?.cctp ?? null;
}

export function isFastTransferEmitter(config: RelayerConfig, address: string): boolean {
    return Object.values(config.routers).some(
        (router) => router.router == ethers.utils.getAddress(address)
    );
}

export function parseRelevantPayload(config: RelayerConfig, sender: string, payloadArray: Buffer) {
    if (isFastTransferEmitter(config, sender)) {
        return MessageDecoder.unsafeDecodeFastPayload(payloadArray);
    }

    return null;
}

export function getRpc(rpcEvnVariable: any): WebSocketProvider {
    const rpc = rpcEvnVariable;
    if (!rpc || !rpc.startsWith("ws")) {
        console.error("RPC is required and must be a websocket:", rpc);
        process.exit(1);
    }
    const websocket = new WebSocketProvider(rpc);
    return websocket;
}

export async function sleep(timeout: number) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
}

export async function auctionStillOpen(
    auctionId: Buffer,
    engine: EvmMatchingEngine
): Promise<boolean> {
    const auctionDuration = await engine.getAuctionDuration();
    const currentBlock = ethers.BigNumber.from(await engine.provider.getBlockNumber());

    // Sometimes the auction block is not updated immediately following the transaction.
    // So we need to loop until the auction start block is set.
    let counter = 0;
    let startBlock: ethers.BigNumber = ethers.BigNumber.from(0);
    while (counter < 5) {
        let _startBlock = await engine
            .liveAuctionInfo(auctionId)
            .then((res) => ethers.BigNumber.from(res.startBlock));

        if (_startBlock.gt(0)) {
            startBlock = _startBlock;
            break;
        }
        counter++;
        await sleep(500);
    }

    if (startBlock.eq(0)) {
        throw new Error("Auction start block not set.");
    }

    if (currentBlock.sub(startBlock).lte(auctionDuration)) {
        return true;
    } else {
        return false;
    }
}

function findCircleMessageInLogs(
    logs: ethers.providers.Log[],
    circleEmitterAddress: string
): string | null {
    for (const log of logs) {
        if (log.address === circleEmitterAddress && log.topics[0] === CIRCLE_BURN_MESSAGE_TOPIC) {
            const messageSentIface = new ethers.utils.Interface([
                "event MessageSent(bytes message)",
            ]);
            return messageSentIface.parseLog(log).args.message as string;
        }
    }

    return null;
}

async function getCircleAttestation(messageHash: ethers.BytesLike, timeout: number = 2000) {
    while (true) {
        // get the post
        const response = await axios
            .get(`https://iris-api-sandbox.circle.com/attestations/${messageHash}`)
            .catch(() => {
                return null;
            })
            .then(async (response: AxiosResponse | null) => {
                if (
                    response !== null &&
                    response.status === 200 &&
                    response.data.status === "complete"
                ) {
                    return response.data.attestation as string;
                }

                return null;
            });

        if (response !== null) {
            return response;
        }

        await sleep(timeout);
    }
}

export async function handleCircleMessageInLogs(
    logs: ethers.providers.Log[],
    circleEmitterAddress: string
): Promise<[string | null, string | null]> {
    const circleMessage = findCircleMessageInLogs(logs, circleEmitterAddress);
    if (circleMessage === null) {
        return [null, null];
    }

    const circleMessageHash = ethers.utils.keccak256(circleMessage);
    const signature = await getCircleAttestation(circleMessageHash);

    return [circleMessage, signature];
}
