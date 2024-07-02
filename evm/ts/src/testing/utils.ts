import { Network } from "@wormhole-foundation/sdk-base";
import { signAndSendWait } from "@wormhole-foundation/sdk-connect";
import {
    SignAndSendSigner,
    UnsignedTransaction,
    toUniversal,
} from "@wormhole-foundation/sdk-definitions";
import { EvmChains, EvmNativeSigner } from "@wormhole-foundation/sdk-evm";
import { ethers, isError } from "ethers";
import { MatchingEngine } from "..";
import { IERC20 } from "../types";
import { IUSDC__factory } from "../types/factories/IUSDC__factory";
import { WALLET_PRIVATE_KEYS } from "./consts";

export interface ScoreKeeper {
    player: ethers.Wallet;
    bid: bigint;
    balance: bigint;
}

export function getSdkSigner<C extends EvmChains>(
    fromChain: C,
    wallet: ethers.Wallet | ethers.NonceManager,
): SdkSigner<Network, C> {
    wallet = "reset" in wallet ? wallet : new ethers.NonceManager(wallet);

    return new SdkSigner(
        fromChain,
        "",
        // @ts-ignore -- incorrect ethers version
        wallet,
    );
}

export class SdkSigner<N extends Network, C extends EvmChains>
    extends EvmNativeSigner<N, C>
    implements SignAndSendSigner<N, C>
{
    get provider() {
        return this._signer.provider as unknown as ethers.JsonRpcProvider;
    }
    get wallet() {
        return this._signer as unknown as ethers.NonceManager;
    }

    // Does not wait for confirmations
    async signSendOnly(txs: UnsignedTransaction<N, C>[]): Promise<string[]> {
        this._address = await this.wallet.getAddress();

        const txids: string[] = [];
        for (let tx of txs) {
            for (let retries = 0; retries < 3; retries++) {
                try {
                    const res = await this._signer.sendTransaction(tx.transaction);
                    txids.push(res.hash);
                    break;
                } catch (e) {
                    if (
                        (isError(e, "CALL_EXCEPTION") &&
                            "info" in e &&
                            e.info!.error.message === "nonce too low") ||
                        isError(e, "NONCE_EXPIRED")
                    ) {
                        await sleep(1);
                        this.wallet.reset();
                        const nonce = await this.wallet.getNonce("pending");
                        if (this.opts?.debug)
                            console.log("Setting nonce for", this.address(), " to ", nonce);

                        tx.transaction.nonce = nonce;
                        continue;
                    }
                    throw e;
                }
            }
        }
        return txids;
    }

    // Mine and wait for transaction
    async signAndSend(txs: UnsignedTransaction<N, C>[]): Promise<string[]> {
        try {
            const txids = await this.signSendOnly(txs);
            await mine(this.provider);
            await this.provider.waitForTransaction(txids[0], 1, 5000);
            return txids;
        } catch (e) {
            console.error(e);
            throw e;
        }
    }
}

export const sleep = async (seconds: number) =>
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export function getSigners(key: string, provider: ethers.Provider) {
    const wallet = new ethers.Wallet(key, provider);
    return { wallet, signer: getSdkSigner("Ethereum", new ethers.NonceManager(wallet)) };
}

export async function mine(provider: ethers.JsonRpcProvider) {
    await provider.send("evm_mine", []);
}

export async function mineMany(provider: ethers.JsonRpcProvider, count: number) {
    for (let i = 0; i < count; i++) {
        await mine(provider);
    }
}

export function asUniversalBytes(address: string) {
    return toUniversal("Ethereum", address).toUint8Array();
}

export async function mineToGracePeriod(
    auctionId: Uint8Array,
    engine: MatchingEngine,
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
    engine: MatchingEngine,
    provider: ethers.JsonRpcProvider,
    penaltyBlocks: number,
) {
    const startBlock = await engine.liveAuctionInfo(auctionId).then((info) => info.startBlock);
    const gracePeriod = await engine.getAuctionGracePeriod();
    const currentBlock = BigInt(await provider.getBlockNumber());

    const blocksToMine = gracePeriod - (currentBlock - startBlock) + BigInt(penaltyBlocks);
    await mineMany(provider, Number(blocksToMine));
}

export async function signSendOnly<N extends Network, C extends EvmChains>(
    txs: AsyncGenerator<UnsignedTransaction<N, C>, void, unknown>,
    signer: SdkSigner<N, C>,
) {
    const txns = [];
    for await (const tx of txs) txns.push(tx);
    await signer.signSendOnly(txns);
}

export async function signSendMineWait<N extends Network, C extends EvmChains>(
    txs: AsyncGenerator<UnsignedTransaction<N, C>, void, unknown>,
    signer: SdkSigner<N, C>,
) {
    const txids = await signAndSendWait(txs, signer);
    return await signer.provider.waitForTransaction(txids[txids.length - 1].txid);
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
