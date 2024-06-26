import { ethers } from "ethers";
import { IERC20 } from "../types";
import { IUSDC__factory } from "../types/factories/IUSDC__factory";
import { WALLET_PRIVATE_KEYS } from "./consts";
import { EvmMatchingEngine } from "..";
import { Chain } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

export interface ScoreKeeper {
    player: ethers.NonceManager;
    bid: bigint;
    balance: bigint;
}

export async function mine(provider: ethers.JsonRpcProvider) {
    await provider.send("evm_mine", []);
}

export async function mineMany(provider: ethers.JsonRpcProvider, count: number) {
    for (let i = 0; i < count; i++) {
        await mine(provider);
    }
}

export function tryNativeToUint8Array(address: string, chain: Chain) {
    return toUniversal(chain, address).toUint8Array();
}

export async function mineToGracePeriod(
    auctionId: Uint8Array,
    engine: EvmMatchingEngine,
    provider: ethers.JsonRpcProvider,
) {
    const { startBlock } = await engine.liveAuctionInfo(auctionId);
    const gracePeriod = await engine.getAuctionGracePeriod();
    const currentBlock = BigInt(await provider.getBlockNumber());

    // Will mine blocks until there is one block left in the grace period.
    const blocksToMine = gracePeriod - (currentBlock - startBlock) - 2n;
    await mineMany(provider, Number(blocksToMine));
}

export async function mineToPenaltyPeriod(
    auctionId: Uint8Array,
    engine: EvmMatchingEngine,
    provider: ethers.JsonRpcProvider,
    penaltyBlocks: number,
) {
    const startBlock = await engine.liveAuctionInfo(auctionId).then((info) => info.startBlock);
    const gracePeriod = await engine.getAuctionGracePeriod();
    const currentBlock = BigInt(await provider.getBlockNumber());

    const blocksToMine = gracePeriod - (currentBlock - startBlock) + BigInt(penaltyBlocks);
    await mineMany(provider, Number(blocksToMine));
}

export async function mineWait(provider: ethers.JsonRpcProvider, tx: ethers.TransactionResponse) {
    await mine(provider);
    // 1 is default confirms, 5000ms timeout to prevent hanging forever.
    return await tx.wait(1, 5000);
}

export async function mintNativeUsdc(
    usdc: IERC20,
    recipient: string,
    amount: ethers.BigNumberish,
    mineBlock: boolean = true,
) {
    if (!usdc.runner) {
        throw new Error("provider must be a JsonRpcProvider");
    }

    const provider = usdc.runner.provider as ethers.JsonRpcProvider;

    const address = await usdc.getAddress();
    const tx = await IUSDC__factory.connect(
        address,
        new ethers.Wallet(WALLET_PRIVATE_KEYS[9], provider),
    ).mint(recipient, amount);

    if (mineBlock) {
        await mineWait(provider, tx);
    }
}

export async function burnAllUsdc(usdc: IERC20) {
    const signer = usdc.runner! as ethers.Signer;
    const address = signer.getAddress();

    await usdc
        .balanceOf(address)
        .then((balance) => usdc.transfer("0x6969696969696969696969696969696969696969", balance))
        .then((tx) => mineWait(usdc.runner?.provider as ethers.JsonRpcProvider, tx));
}
