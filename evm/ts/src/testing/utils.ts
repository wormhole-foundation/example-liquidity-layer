import { ethers, isError } from "ethers";
import { IERC20 } from "../types";
import { IUSDC__factory } from "../types/factories/IUSDC__factory";
import { WALLET_PRIVATE_KEYS } from "./consts";
import { EvmMatchingEngine } from "..";
import { signAndSendWait } from "@wormhole-foundation/sdk-connect";
import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    SignAndSendSigner,
    UnsignedTransaction,
    toNative,
    toUniversal,
} from "@wormhole-foundation/sdk-definitions";
import { EvmChains, EvmNativeSigner } from "@wormhole-foundation/sdk-evm";

export interface ScoreKeeper {
    player: ethers.NonceManager;
    bid: bigint;
    balance: bigint;
}

export function getSdkSigner<C extends EvmChains>(
    fromChain: C,
    wallet: ethers.Wallet,
): SdkSigner<Network, C> {
    // @ts-ignore -- TODO, add peer dep to sdk-evm package for ethers
    return new SdkSigner(fromChain, wallet.address, wallet);
}

export class SdkSigner<N extends Network, C extends EvmChains>
    extends EvmNativeSigner<N, C>
    implements SignAndSendSigner<N, C>
{
    get provider() {
        return this._signer.provider as unknown as ethers.JsonRpcProvider;
    }
    get wallet() {
        return this._signer as unknown as ethers.Wallet;
    }

    async signAndSend(txs: UnsignedTransaction<N, C>[]): Promise<string[]> {
        const txids: string[] = [];
        for (let tx of txs) {
            for (let x = 0; x < 3; x++) {
                try {
                    const res = await this._signer.sendTransaction(tx.transaction);
                    txids.push(res.hash);
                    break;
                } catch (e) {
                    if (
                        isError(e, "CALL_EXCEPTION") &&
                        "info" in e &&
                        e.info!.error.message === "nonce too low"
                    ) {
                        const nonce = await this.wallet.getNonce();
                        console.log("Setting nonce to ", nonce);
                        tx.transaction.nonce = nonce;
                        continue;
                    }
                    throw e;
                }
            }
        }

        await mine(this.provider);
        await this.provider.waitForTransaction(txids[0], 1, 5000);
        return txids;
    }
}

export const sleep = async (seconds: number) =>
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export const nonceManagedWallet = (key: string, provider: ethers.Provider) =>
    new ethers.NonceManager(new ethers.Wallet(key, provider));

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

export async function signSendMineWait<N extends Network, C extends EvmChains>(
    txs: AsyncGenerator<UnsignedTransaction<N, C>, void, unknown>,
    signer: SdkSigner<N, C>,
) {
    const txids = await signAndSendWait(txs, signer);
    return await signer.provider.waitForTransaction(txids[0].txid);
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
