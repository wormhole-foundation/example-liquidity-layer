import {
    ComputeBudgetProgram,
    Connection,
    SystemProgram,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    TransactionInstruction,
    DurableNonce,
    BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";
import * as winston from "winston";
import { PreparedTransaction } from "../../src";

export async function getNonceAccountData(
    connection: Connection,
    nonceAccount: PublicKey,
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
    logger?: winston.Logger,
    cachedBlockhash?: BlockhashWithExpiryBlockHeight,
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
    const [messageV0, confirmStrategy] = await (async () => {
        if (nonceAccount === undefined) {
            const latestBlockhash = cachedBlockhash ?? (await connection.getLatestBlockhash());

            return [
                new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: [computeLimitIx, computeUnitPriceIx, ...ixs],
                }).compileToV0Message(addressLookupTableAccounts),
                latestBlockhash,
            ];
        } else {
            const { nonce, recentSlot, advanceIxs } = await getNonceAccountData(
                connection,
                nonceAccount,
            );

            return [
                new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: nonce,
                    instructions: [...advanceIxs, computeLimitIx, computeUnitPriceIx, ...ixs],
                }).compileToV0Message(addressLookupTableAccounts),
                {
                    minContextSlot: recentSlot,
                    nonceAccountPubkey: nonceAccount,
                    nonceValue: nonce,
                },
            ];
        }
    })();

    const tx = new VersionedTransaction(messageV0);
    tx.sign(signers);

    const txSignature = await connection
        .sendTransaction(tx, preparedTransaction.confirmOptions)
        .then(async (signature) => {
            const commitment = preparedTransaction.confirmOptions?.commitment;
            if (commitment !== undefined) {
                await connection.confirmTransaction(
                    {
                        signature,
                        ...confirmStrategy,
                    },
                    commitment,
                );
            }
            return signature;
        })
        .catch((err) => {
            console.log(err);
            if (err.logs !== undefined) {
                const logs: string[] = err.logs;
                if (logger !== undefined) {
                    logger.warn(logs.join("\n"));
                }
            } else {
                if (logger !== undefined) {
                    logger.warn(err.message);
                }
            }
        });

    if (logger !== undefined) {
        if (preparedTransaction.txName !== undefined) {
            logger.debug(
                `Transaction type: ${preparedTransaction.txName}, signature: ${txSignature}`,
            );
        } else {
            logger.debug(`Transaction signature: ${txSignature}`);
        }
    }

    return tx;
}
