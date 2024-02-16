import { Connection, PublicKey } from "@solana/web3.js";
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

    const logicLogger = utils.defaultLogger({ label: "logic", level: "debug" });
    logicLogger.info("Start logging logic");

    const matchingEngine = new MatchingEngineProgram(
        cfg.solanaConnection(),
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    const participant = new AuctionParticipant(
        matchingEngine,
        cfg.recognizedTokenAccounts(),
        logicLogger,
    );

    matchingEngine.onAuctionUpdate(await participant.onAuctionUpdateCallback());
}
