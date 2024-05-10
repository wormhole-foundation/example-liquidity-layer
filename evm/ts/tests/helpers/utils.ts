import { ethers } from "ethers";
import { IERC20 } from "../../src/types";
import { IUSDC__factory } from "../../src/types/factories/IUSDC__factory";
import { WALLET_PRIVATE_KEYS } from "./consts";
import { EvmMatchingEngine } from "../../src";
import { Chain, toUniversal } from "@wormhole-foundation/sdk";

export interface ScoreKeeper {
    player: ethers.Wallet;
    bid: ethers.BigNumber;
    balance: ethers.BigNumber;
}

export async function mine(provider: ethers.providers.StaticJsonRpcProvider) {
    await provider.send("evm_mine", []);
}

export async function mineMany(provider: ethers.providers.StaticJsonRpcProvider, count: number) {
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
    provider: ethers.providers.StaticJsonRpcProvider,
) {
    const startBlock = await engine.liveAuctionInfo(auctionId).then((info) => info.startBlock);
    const gracePeriod = await engine.getAuctionGracePeriod();
    const currentBlock = await provider.getBlockNumber();

    // Will mine blocks until there is one block left in the grace period.
    const blocksToMine = gracePeriod - (currentBlock - Number(startBlock)) - 1;
    await mineMany(provider, blocksToMine);
}

export async function mineToPenaltyPeriod(
    auctionId: Uint8Array,
    engine: EvmMatchingEngine,
    provider: ethers.providers.StaticJsonRpcProvider,
    penaltyBlocks: number,
) {
    const startBlock = await engine.liveAuctionInfo(auctionId).then((info) => info.startBlock);
    const gracePeriod = await engine.getAuctionGracePeriod();
    const currentBlock = await provider.getBlockNumber();

    const blocksToMine = gracePeriod - (currentBlock - Number(startBlock)) + penaltyBlocks;
    await mineMany(provider, blocksToMine);
}

export async function mineWait(
    provider: ethers.providers.StaticJsonRpcProvider,
    tx: ethers.ContractTransaction,
) {
    await mine(provider);
    return tx.wait();
}

export async function mintNativeUsdc(
    usdc: IERC20,
    recipient: string,
    amount: ethers.BigNumberish,
    mineBlock: boolean = true,
) {
    if (!("detectNetwork" in usdc.provider)) {
        throw new Error("provider must be a StaticJsonRpcProvider");
    }

    const provider = usdc.provider as ethers.providers.StaticJsonRpcProvider;

    const tx = await IUSDC__factory.connect(
        usdc.address,
        new ethers.Wallet(WALLET_PRIVATE_KEYS[9], provider),
    ).mint(recipient, amount);

    if (mineBlock) {
        await mineWait(provider, tx);
    }
}

export async function burnAllUsdc(usdc: IERC20) {
    await usdc
        .balanceOf(usdc.signer.getAddress())
        .then((balance) => usdc.transfer("0x6969696969696969696969696969696969696969", balance))
        .then((tx) => mineWait(usdc.provider as ethers.providers.StaticJsonRpcProvider, tx));
}
