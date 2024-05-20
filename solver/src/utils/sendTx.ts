import {
    ComputeBudgetProgram,
    Connection,
    SystemProgram,
    PublicKey,
    TransactionMessage,
    VersionedTransaction,
    TransactionInstruction,
    BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";
import * as winston from "winston";
import { PreparedTransaction } from "@wormhole-foundation/example-liquidity-layer-solana";

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

export async function sendTxBatch(
    connection: Connection,
    preparedTransactions: PreparedTransaction[],
    logger?: winston.Logger,
    retryCount?: number,
    cachedBlockhash?: BlockhashWithExpiryBlockHeight,
): Promise<void> {
    for (const preparedTransaction of preparedTransactions) {
        const skipPreFlight = preparedTransaction.confirmOptions?.skipPreflight ?? false;

        // If skipPreFlight is false, we will retry the transaction if it fails.
        let success = false;
        let counter = 0;
        while (!success && counter < (retryCount ?? 5)) {
            const response = await sendTx(connection, preparedTransaction, logger, cachedBlockhash);

            if (skipPreFlight) {
                break;
            }

            success = response.success;
            counter++;

            if (logger !== undefined && !success) {
                logger.error(`Retrying failed transaction, attempt=${counter}`);
            }

            // Wait half a slot before trying again.
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (!success) {
            return;
        }
    }
}

export async function sendTx(
    connection: Connection,
    preparedTransaction: PreparedTransaction,
    logger?: winston.Logger,
    cachedBlockhash?: BlockhashWithExpiryBlockHeight,
): Promise<{ success: boolean; txSig: string | void }> {
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

    let success = true;
    let txSignature = await connection
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
            success = false;

            if (err.logs !== undefined) {
                const logs: string[] = err.logs;
                if (logger !== undefined) {
                    logger.error(logs.join("\n"));
                }
            } else {
                if (logger !== undefined) {
                    logger.error(err);
                }
            }
        });

    if (logger !== undefined) {
        if (preparedTransaction.txName !== undefined) {
            logger.info(
                `Transaction type: ${preparedTransaction.txName}, signature: ${txSignature}`,
            );
        } else {
            logger.info(`Transaction signature: ${txSignature}`);
        }
    }

    return { success, txSig: txSignature };
}
