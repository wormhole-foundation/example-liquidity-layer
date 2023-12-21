import {Keypair, Connection, PublicKey} from "@solana/web3.js";
import {getOrCreateAssociatedTokenAccount} from "@solana/spl-token";
import {RPC} from "./helpers/consts";
import yargs from "yargs";
import * as fs from "fs";

export function getArgs() {
  const argv = yargs.options({
    keyPair: {
      alias: "k",
      describe: "Signer Keypair",
      require: true,
      string: true,
    },
    mint: {
      alias: "m",
      describe: "Mint",
      require: true,
      string: true,
    },
  }).argv;

  if ("keyPair" in argv && "mint" in argv) {
    return {
      keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
      mint: new PublicKey(argv.mint),
    };
  } else {
    throw Error("Invalid arguments");
  }
}

async function main() {
  // Set up provider.
  const connection = new Connection(RPC, "confirmed");

  // Owner wallet.
  const {keyPair, mint} = getArgs();
  const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

  // Create associated token account.
  const tx = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );

  console.log("ATA", tx);
}

main();
