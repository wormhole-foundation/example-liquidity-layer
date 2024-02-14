import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { AuctionParameters, MatchingEngineProgram } from "../src/matchingEngine";

const PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const AUCTION_PARAMS: AuctionParameters = {
    userPenaltyRewardBps: 400000, // 40%
    initialPenaltyBps: 250000, // 25%
    duration: 5, // slots
    gracePeriod: 10, // slots
    penaltyPeriod: 20, // slots
    minOfferDeltaBps: 50000, // 5%
};

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const matchingEngine = new MatchingEngineProgram(connection, PROGRAM_ID, USDC_MINT);

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    // Set up program.
    await propose(matchingEngine, payer);
}

async function propose(matchingEngine: MatchingEngineProgram, payer: Keypair) {
    const connection = matchingEngine.program.provider.connection;

    const custodian = matchingEngine.custodianAddress();
    console.log("custodian", custodian.toString());

    const ix = await matchingEngine.proposeAuctionParametersIx(
        {
            ownerOrAssistant: payer.publicKey,
        },
        AUCTION_PARAMS,
    );

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
        .catch((err) => {
            console.log(err.logs);
            throw err;
        })
        .then((txSig) => {
            console.log("proposal", txSig);
        });
}
