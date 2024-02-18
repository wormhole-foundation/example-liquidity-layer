import {
    Connection,
    FetchFn,
    FetchMiddleware,
    Keypair,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import "dotenv/config";
import * as fs from "fs";
import { MatchingEngineProgram } from "../../src/matchingEngine";
import * as utils from "../utils";
import { AuctionParticipant } from "./AuctionParticipant";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

main(process.argv);

async function main(argv: string[]) {
    const cfgJson = JSON.parse(fs.readFileSync(argv[2], "utf-8"));
    const cfg = new utils.AppConfig(cfgJson);

    const auctionLogger = utils.defaultLogger({ label: "auction", level: "debug" });
    auctionLogger.info("Start logging auction participation.");

    const orderLogger = utils.defaultLogger({ label: "order", level: "debug" });
    orderLogger.info("Start logging order execution.");

    const connection = cfg.solanaConnection(
        true, // debug
    );
    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const offerAuthority = Keypair.fromSecretKey(
        Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"),
    );

    const participant = new AuctionParticipant(
        matchingEngine,
        offerAuthority,
        cfg.recognizedTokenAccounts(),
        auctionLogger,
    );

    matchingEngine.onAuctionUpdate(await participant.onAuctionUpdateCallback());

    const updateBlockhashFrequency = 16; // slots
    connection.onSlotChange(async (info) => {
        const { slot } = info;

        // Update the latest blockhash every `updateBlockhashFrequency` slots.
        if (slot % updateBlockhashFrequency == 0) {
            // No need to block. We'll just update the latest blockhash and use it when needed.
            connection
                .getLatestBlockhash("finalized")
                .then((blockhash) => participant.updateLatestBlockhash(blockhash));
        }
        // else {
        //     const prepped = {
        //         ixs: [
        //             SystemProgram.transfer({
        //                 fromPubkey: offerAuthority.publicKey,
        //                 toPubkey: offerAuthority.publicKey,
        //                 lamports: 1,
        //             }),
        //         ],
        //         signers: [offerAuthority],
        //         feeMicroLamports: participant.adjustedFeeMicroLamports(6969),
        //         computeUnits: 1_000,
        //         txName: "Test Tx",
        //         confirmOptions: {
        //             skipPreflight: true,
        //         },
        //     };
        //     utils.sendTx(connection, prepped, orderLogger, participant.cachedBlockhash());
        // }

        // TODO: Check participant's winning auctions and execute orders.
    });
}
