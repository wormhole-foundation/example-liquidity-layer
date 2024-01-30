import { postVaaSolana, solana as wormSolana } from "@certusone/wormhole-sdk";
import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableAccount,
    ConfirmOptions,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { execSync } from "child_process";
import { Err, Ok } from "ts-results";
import { CORE_BRIDGE_PID, USDC_MINT_ADDRESS } from "./consts";

async function confirmLatest(connection: Connection, signature: string) {
    return connection.getLatestBlockhash().then(({ blockhash, lastValidBlockHeight }) =>
        connection.confirmTransaction(
            {
                blockhash,
                lastValidBlockHeight,
                signature,
            },
            "confirmed"
        )
    );
}

export async function expectIxOk(
    connection: Connection,
    instructions: TransactionInstruction[],
    signers: Signer[],
    options: {
        addressLookupTableAccounts?: AddressLookupTableAccount[];
        confirmOptions?: ConfirmOptions;
    } = {}
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
    } = {}
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
    } = {}
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
    } = {}
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
                confirmOptions === undefined ? "confirmed" : confirmOptions.commitment
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
    payer: Keypair,
    vaaBuf: Buffer,
    coreBridgeAddress?: PublicKey
) {
    await postVaaSolana(
        connection,
        new wormSolana.NodeWallet(payer).signTransaction,
        coreBridgeAddress ?? CORE_BRIDGE_PID,
        payer.publicKey,
        vaaBuf
    );
}

export function loadProgramBpf(artifactPath: string, bufferAuthority: PublicKey): PublicKey {
    // Write keypair to temporary file.
    const keypath = `${__dirname}/../keys/pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ.json`;

    // Invoke BPF Loader Upgradeable `write-buffer` instruction.
    const buffer = (() => {
        const output = execSync(`solana -u l -k ${keypath} program write-buffer ${artifactPath}`);
        const pubkeyStr = output.toString().match(/^.{8}([A-Za-z0-9]+)/);
        if (pubkeyStr === null) {
            throw new Error("Could not parse pubkey from output");
        }
        return new PublicKey(pubkeyStr);
    })();

    // Invoke BPF Loader Upgradeable `set-buffer-authority` instruction.
    execSync(
        `solana -k ${keypath} program set-buffer-authority ${buffer.toString()} --new-buffer-authority ${bufferAuthority.toString()} -u localhost`
    );

    // Return the pubkey for the buffer (our new program implementation).
    return buffer;
}

export function getRandomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);

    // The maximum is exclusive and the minimum is inclusive.
    return Math.floor(Math.random() * (max - min) + min);
}

export function getRandomBN(numBytes: number, range?: { min: BN; max: BN }) {
    const base = new BN(getRandomInt(1, 256)).pow(new BN(getRandomInt(1, numBytes))).subn(1);
    if (range === undefined) {
        return new BN(base.toArray("le", numBytes), undefined, "le");
    } else {
        const absMax = new BN(256).pow(new BN(numBytes)).subn(1);
        const { min, max } = range;
        if (max.sub(min).lten(0)) {
            throw new Error("max must be greater than min");
        } else if (max.gt(absMax)) {
            throw new Error(`max must be less than 256 ** ${numBytes}`);
        }

        const result = min.mul(absMax).add(max.sub(min).mul(base)).div(absMax);
        return new BN(result.toArray("le", numBytes), undefined, "le");
    }
}

export function bigintToU64BN(value: bigint): BN {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(value);
    return new BN(buf);
}

export function numberToU64BN(value: number): BN {
    return bigintToU64BN(BigInt(value));
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

export async function getUsdcAtaBalance(connection: Connection, owner: PublicKey) {
    const { amount } = await splToken.getAccount(
        connection,
        splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, owner)
    );
    return amount;
}
