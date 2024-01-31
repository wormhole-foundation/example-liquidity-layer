import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { TokenRouterProgram } from "../src/tokenRouter";

const PROGRAM_ID = "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const tokenRouter = new TokenRouterProgram(connection, PROGRAM_ID, USDC_MINT);

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "hex"));

    // Set up program.
    await intialize(tokenRouter, payer);
}

async function intialize(tokenRouter: TokenRouterProgram, payer: Keypair) {
    const connection = tokenRouter.program.provider.connection;

    const custodian = tokenRouter.custodianAddress();
    console.log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        console.log("already initialized");
        return;
    }

    const ix = await tokenRouter.initializeIx({
        owner: payer.publicKey,
        ownerAssistant: payer.publicKey,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
        .catch((err) => {
            console.log(err.logs);
            throw err;
        })
        .then((txSig) => {
            console.log("intialize", txSig);
        });
}
