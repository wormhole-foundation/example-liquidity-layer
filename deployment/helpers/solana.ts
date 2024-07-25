import {
  Transaction,
  TransactionInstruction,
  Keypair,
  PublicKey,
  Connection,
  Commitment
} from "@solana/web3.js";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { ecosystemChains, getEnv } from "./env";
import type { SolanaScriptCb } from "./interfaces";
import { inspect } from "util";

export const connectionCommitmentLevel = (process.env.SOLANA_COMMITMENT || "confirmed") as Commitment;
export const priorityMicrolamports = process.env.PRIORITY_MICROLAMPORTS !== "undefined" ? Number(process.env.PRIORITY_MICROLAMPORTS) : 1;

export function validateSolAddress(address: string){
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch (error) {
      return false;
    }
}

export function solanaOperatingChains() {
  const { operatingChains } = ecosystemChains;
  if (Array.isArray(operatingChains) && operatingChains.length >= 1) {
    return ecosystemChains.solana.networks.filter((x) => {
      return operatingChains.includes(x.chainId);
    });
  }
  return ecosystemChains.solana.networks;
};

export async function runOnSolana(scriptName: string, cb: SolanaScriptCb) {
  const chains = solanaOperatingChains();

  console.log(`Running script on Solana:`, scriptName);

  const result = chains.map(async chain => {
    const log = (...args: any[]) => console.log(`[${chain.chainId}]`, ...args);
    const signer = await getSigner();
    // TODO: encode in base58
    log(`Starting script. Signer: ${(await signer.getAddress()).toString("hex")}`);

    try {
      await cb(chain, signer, log);
      log("Success");
    } catch (error) {
      log("Error: ", (error as any)?.stack || inspect(error, {depth: 5}));
    }
    console.log();
  });

  await Promise.all(result);
}

let signer: SolanaLedgerSigner | null;
export async function getSigner(): Promise<SolanaLedgerSigner> {
  if (!signer) {
    const derivationPath = getEnv("SOLANA_LEDGER_BIP32_PATH");
    signer = await SolanaLedgerSigner.create(derivationPath);
  }

  return signer;
}

export async function ledgerSignAndSend(connection: Connection, instructions: TransactionInstruction[], signers: Keypair[]) {
  const deployerSigner = await getSigner();
  const deployerPk = new PublicKey(await deployerSigner.getAddress());

  const tx = new Transaction();

  tx.add(...instructions);

  const recentBlockHash = await connection.getLatestBlockhash();

  tx.recentBlockhash = recentBlockHash.blockhash;
  tx.feePayer = deployerPk;

  signers.forEach((signer) => tx.partialSign(signer));

  await addLedgerSignature(tx, deployerSigner, deployerPk);

  return connection.sendRawTransaction(tx.serialize());
}

async function addLedgerSignature(tx: Transaction, signer: SolanaLedgerSigner, signerPk: PublicKey) {
  const signedByPayer = await signer.signTransaction(tx.compileMessage().serialize());
  tx.addSignature(signerPk, signedByPayer);
}