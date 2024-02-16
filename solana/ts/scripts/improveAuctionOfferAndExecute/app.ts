import { Connection, PublicKey } from "@solana/web3.js";
import "dotenv/config";
import { AuctionParticipant } from "./AuctionParticipant";
import * as utils from "../utils";
import { MatchingEngineProgram } from "../../src/matchingEngine";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

main(process.argv);

async function main(argv: string[]) {
    // TODO: read config
    const logicLogger = utils.defaultLogger({ label: "logic", level: "debug" });
    logicLogger.info("Start logging logic");

    if (process.env.SOLANA_SUB_RPC === undefined) {
        throw new Error("SOLANA_SUB_RPC is undefined");
    }
    if (process.env.SOLANA_REQ_RPC === undefined) {
        throw new Error("SOLANA_REQ_RPC is undefined");
    }

    const connection = new Connection(process.env.SOLANA_REQ_RPC, {
        commitment: "confirmed",
        //wsEndpoint: process.env.SOLANA_SUB_WS,
        wsEndpoint: "wss://api.devnet.solana.com/",
    });
    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    const recognizedPayers = ["2SiZZ6cUrrjCjQdTrBjW5qv6jLdCzfCP4aDeAB3AKXWM"];
    const participant = new AuctionParticipant(matchingEngine, recognizedPayers, logicLogger);

    matchingEngine.onAuctionUpdate(await participant.onAuctionUpdateCallback());
}
