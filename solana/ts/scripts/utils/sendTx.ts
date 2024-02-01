import {
    ComputeBudgetProgram,
    Connection,
    SystemProgram,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    TransactionInstruction,
} from "@solana/web3.js";
import * as winston from "winston";
import { PreparedTransaction } from "../../src";

export async function getNonceAccountData(
    connection: Connection,
    nonceAccount: PublicKey
): Promise<{ nonce: string; recentSlot: number; advanceIxs: TransactionInstruction[] }> {
    const { context, value } = await connection.getNonceAndContext(nonceAccount);
    if (context === null || value === null) {
        throw new Error("Failed to fetch nonce account data");
    }

    return {
        nonce: value.nonce,
        recentSlot: context.slot,
        advanceIxs: [
            SystemProgram.nonceAdvance({
                authorizedPubkey: value.authorizedPubkey,
                noncePubkey: nonceAccount,
            }),
        ],
    };
}

export async function sendTx(
    connection: Connection,
    preparedTransaction: PreparedTransaction,
    logger: winston.Logger
): Promise<VersionedTransaction> {
    const {
        nonceAccount,
        ixs,
        computeUnits,
        feeMicroLamports,
        signers,
        addressLookupTableAccounts,
    } = preparedTransaction;

    const payer = signers[0];
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits });
    const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: feeMicroLamports,
    });

    // Uptick nonce account, or fetch recent block hash.
    const { nonce, recentSlot, advanceIxs } = await getNonceAccountData(connection, nonceAccount);

    // Format transaction.
    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: nonce,
        instructions: [advanceIxs[0], computeLimitIx, computeUnitPriceIx, ...ixs],
    }).compileToV0Message(addressLookupTableAccounts);
    const tx = new VersionedTransaction(messageV0);

    // Sign and send the transaction.
    tx.sign(signers);
    const txnSignature = await connection
        .sendTransaction(tx, preparedTransaction.sendOptions)
        .then(async (signature) => {
            const commitment = preparedTransaction.sendOptions?.preflightCommitment;
            if (commitment !== undefined) {
                await connection.confirmTransaction(
                    {
                        minContextSlot: recentSlot,
                        nonceAccountPubkey: nonceAccount,
                        nonceValue: nonce,
                        signature,
                    },
                    commitment
                );
            }
            return signature;
        })
        .catch((err) => {
            if (err.logs !== undefined) {
                const logs: string[] = err.logs;
                logger.warn(logs.join("\n"));
            } else {
                logger.warn(err.message);
            }
        });

    logger.debug(`Transaction signature: ${txnSignature}`);

    return tx;
}
