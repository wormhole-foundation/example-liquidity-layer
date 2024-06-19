import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableAccount,
    ConfirmOptions,
    Connection,
    Keypair,
    PublicKey,
    SendTransactionError,
    Signer,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { execSync } from "child_process";
import { Err, Ok } from "ts-results";
import { CORE_BRIDGE_PID, USDC_MINT_ADDRESS } from "./consts";
import { SolanaSendSigner, SolanaUnsignedTransaction } from "@wormhole-foundation/sdk-solana";
import { SolanaWormholeCore, utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { SignAndSendSigner as SdkSigner, signAndSendWait } from "@wormhole-foundation/sdk-connect";
import { UniversalAddress, VAA, deserialize } from "@wormhole-foundation/sdk-definitions";
import { Chain, Network } from "@wormhole-foundation/sdk-base";

export function toUniversalAddress(address: number[] | Buffer | Array<number>): UniversalAddress {
    return new UniversalAddress(new Uint8Array(address));
}

async function confirmLatest(connection: Connection, signature: string) {
    return connection.getLatestBlockhash().then(({ blockhash, lastValidBlockHeight }) =>
        connection.confirmTransaction(
            {
                blockhash,
                lastValidBlockHeight,
                signature,
            },
            "confirmed",
        ),
    );
}

export async function expectTxsOk<N extends Network, C extends "Solana" = "Solana">(
    signer: SdkSigner<N, C>,
    txs: AsyncGenerator<SolanaUnsignedTransaction<N, C>>,
) {
    try {
        return await signAndSendWait(txs, signer);
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export async function expectTxsOkDetails<N extends Network, C extends "Solana" = "Solana">(
    signer: SdkSigner<N, C>,
    txs: AsyncGenerator<SolanaUnsignedTransaction<N, C>>,
    connection: Connection,
) {
    const [txSig] = await expectTxsOk(signer, txs);
    await confirmLatest(connection, txSig.txid);
    return connection.getTransaction(txSig.txid, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    });
}

export async function expectTxsErr<N extends Network, C extends "Solana" = "Solana">(
    signer: SdkSigner<N, C>,
    txs: AsyncGenerator<SolanaUnsignedTransaction<N, C>>,
    expectedError: string,
) {
    try {
        await signAndSendWait(txs, signer);
    } catch (e) {
        const errorMsg =
            e instanceof SendTransactionError && e.logs
                ? e.logs!.join("\n")
                : (e as Error).toString();
        expect(errorMsg).includes(expectedError);
        return;
    }
    throw new Error("Expected transaction to fail");
}

export async function expectIxOk(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[],
    options: {
        addressLookupTableAccounts?: AddressLookupTableAccount[];
        confirmOptions?: ConfirmOptions;
    } = {},
) {
    const { addressLookupTableAccounts, confirmOptions } = options;
    return debugSendAndConfirmTransaction(connection, instructions, signers, {
        addressLookupTableAccounts,
        logError: true,
        confirmOptions,
    }).then((result) => result.unwrap());
}

export async function expectIxErr(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[],
    expectedError: string,
    options: {
        addressLookupTableAccounts?: AddressLookupTableAccount[];
        confirmOptions?: ConfirmOptions;
    } = {},
) {
    const { addressLookupTableAccounts, confirmOptions } = options;
    const errorMsg = await debugSendAndConfirmTransaction(connection, instructions, signers, {
        addressLookupTableAccounts,
        logError: false,
        confirmOptions,
    }).then((result) => {
        if (result.err) {
            return result.toString();
        } else {
            throw new Error("Expected transaction to fail");
        }
    });
    try {
        expect(errorMsg).includes(expectedError);
    } catch (err) {
        console.log(errorMsg);
        throw err;
    }
}

export async function expectIxOkDetails(
    connection: Connection,
    ixs: TransactionInstruction[],
    signers: Signer[],
    options: {
        addressLookupTableAccounts?: AddressLookupTableAccount[];
        confirmOptions?: ConfirmOptions;
    } = {},
) {
    const txSig = await expectIxOk(connection, ixs, signers, options);
    await confirmLatest(connection, txSig);
    return connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    });
}

async function debugSendAndConfirmTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[],
    options: {
        addressLookupTableAccounts?: AddressLookupTableAccount[];
        logError?: boolean;
        confirmOptions?: ConfirmOptions;
    } = {},
) {
    const { logError, confirmOptions, addressLookupTableAccounts } = options;

    const latestBlockhash = await connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
        payerKey: signers[0].publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
    }).compileToV0Message(addressLookupTableAccounts);

    const tx = new VersionedTransaction(messageV0);

    // sign your transaction with the required `Signers`
    tx.sign(signers);

    return connection
        .sendTransaction(tx, confirmOptions)
        .then(async (signature) => {
            await connection.confirmTransaction(
                {
                    signature,
                    ...latestBlockhash,
                },
                confirmOptions === undefined ? "confirmed" : confirmOptions.commitment,
            );
            return new Ok(signature);
        })
        .catch((err) => {
            if (logError) {
                console.log(err);
            }
            if (err.logs !== undefined) {
                const logs: string[] = err.logs;
                return new Err(logs.join("\n"));
            } else {
                return new Err(err.message);
            }
        });
}

export async function postVaa(
    connection: Connection,
    payer: Keypair | SdkSigner<Network, "Solana">,
    vaa: VAA,
    coreBridgeAddress?: PublicKey,
) {
    coreBridgeAddress ??= CORE_BRIDGE_PID;

    const core = new SolanaWormholeCore("Devnet", "Solana", connection, {
        coreBridge: coreBridgeAddress.toString(),
    });

    const signer =
        payer instanceof Keypair
            ? new SolanaSendSigner(connection, "Solana", payer, false, {})
            : payer;

    const txs = core.postVaa(signer.address(), vaa);
    const address = coreUtils.derivePostedVaaKey(coreBridgeAddress, Buffer.from(vaa.hash));
    const txids = await signAndSendWait(txs, signer);

    return { txids, address };
}

export function loadProgramBpf(artifactPath: string, keypath: string): PublicKey {
    // Invoke BPF Loader Upgradeable `write-buffer` instruction.
    const buffer = (() => {
        const output = execSync(`solana -u l -k ${keypath} program write-buffer ${artifactPath}`);
        return new PublicKey(output.toString().match(/^Buffer: ([A-Za-z0-9]+)/)![1]);
    })();

    // Return the pubkey for the buffer (our new program implementation).
    return buffer;
}

export async function waitBySlots(connection: Connection, numSlots: number) {
    const targetSlot = await connection.getSlot().then((slot) => slot + numSlots);
    return waitUntilSlot(connection, targetSlot);
}

export async function waitUntilSlot(connection: Connection, targetSlot: number) {
    return new Promise((resolve, _) => {
        const sub = connection.onSlotChange((slot) => {
            if (slot.slot >= targetSlot) {
                connection.removeSlotChangeListener(sub);
                resolve(slot.slot);
            }
        });
    });
}

export async function waitUntilTimestamp(connection: Connection, targetTimestamp: number) {
    return new Promise((resolve, _) => {
        const sub = connection.onSlotChange(async (slot) => {
            const blockTime = await connection.getBlockTime(slot.slot);
            if (blockTime === null) {
                throw new Error("block time is null");
            } else if (blockTime >= targetTimestamp) {
                connection.removeSlotChangeListener(sub);
                resolve(blockTime);
            }
        });
    });
}

export async function getUsdcAtaBalance(connection: Connection, owner: PublicKey) {
    return splToken
        .getAccount(connection, splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, owner))
        .then((token) => token.amount)
        .catch(() => 0n);
}

export async function getBlockTime(connection: Connection): Promise<number> {
    // This should never fail.
    return connection
        .getSlot()
        .then(async (slot) => connection.getBlockTime(slot))
        .then((value) => value!);
}
