import {
  Connection,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Transaction,
  Signer,
  ComputeBudgetProgram,
  ConfirmOptions,
  PublicKeyInitData,
  PublicKey,
} from "@solana/web3.js";
import {deriveWrappedMintKey} from "@certusone/wormhole-sdk/lib/cjs/solana/tokenBridge";
import {
  postVaaSolanaWithRetry,
  NodeWallet,
} from "@certusone/wormhole-sdk/lib/cjs/solana";
import {
  CHAIN_ID_SOLANA,
  ChainId,
  ParsedTokenTransferVaa,
} from "@certusone/wormhole-sdk";
import {getOrCreateAssociatedTokenAccount} from "@solana/spl-token";

export class SendIxError extends Error {
  logs: string;

  constructor(originalError: Error & {logs?: string[]}) {
    // The newlines don't actually show up correctly in chai's assertion error, but at least
    // we have all the information and can just replace '\n' with a newline manually to see
    // what's happening without having to change the code.
    const logs = originalError.logs?.join("\n") || "error had no logs";
    super(originalError.message + "\nlogs:\n" + logs);
    this.stack = originalError.stack;
    this.logs = logs;
  }
}

export const sendAndConfirmIx = async (
  connection: Connection,
  ix: TransactionInstruction | Promise<TransactionInstruction>,
  signer: Signer,
  computeUnits?: number,
  options?: ConfirmOptions
) => {
  let [signers, units] = (() => {
    if (signer) return [[signer], computeUnits];

    return [Array.isArray(signer) ? signer : [signer], computeUnits];
  })();

  if (options === undefined) {
    options = {};
  }
  options.maxRetries = 10;

  const tx = new Transaction().add(await ix);
  if (units) tx.add(ComputeBudgetProgram.setComputeUnitLimit({units}));
  try {
    return await sendAndConfirmTransaction(connection, tx, signers, options);
  } catch (error: any) {
    console.log(error);
    throw new SendIxError(error);
  }
};

export async function postVaaOnSolana(
  connection: Connection,
  payer: Signer,
  coreBridge: PublicKeyInitData,
  signedMsg: Buffer
) {
  const wallet = NodeWallet.fromSecretKey(payer.secretKey);
  await postVaaSolanaWithRetry(
    connection,
    wallet.signTransaction,
    coreBridge,
    wallet.key(),
    signedMsg
  );
}

export async function createATAForRecipient(
  connection: Connection,
  payer: Signer,
  tokenBridgeProgramId: PublicKeyInitData,
  recipient: PublicKey,
  tokenChain: ChainId,
  tokenAddress: Buffer
) {
  // Get the mint.
  let mint;
  if (tokenChain === CHAIN_ID_SOLANA) {
    mint = new PublicKey(tokenAddress);
  } else {
    mint = deriveWrappedMintKey(tokenBridgeProgramId, tokenChain, tokenAddress);
  }

  // Get or create the ATA.
  try {
    await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient);
  } catch (error: any) {
    throw new Error("Failed to create ATA: " + (error?.stack || error));
  }
}
