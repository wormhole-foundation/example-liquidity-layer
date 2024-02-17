import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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

    const connection = cfg.solanaConnection();
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

    connection.onSlotChange(async (info) => {
        // orderLogger.debug(`Slot changed to ${info.slot}.`);
    });
}
