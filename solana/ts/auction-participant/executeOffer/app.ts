import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import "dotenv/config";
import * as fs from "fs";
import winston from "winston";
import { AuctionUpdated, FEE_PRECISION_MAX, MatchingEngineProgram } from "../../src/matchingEngine";
import * as utils from "../utils";
import { CachedBlockhash, OfferToken } from "./containers";
import { BN } from "@coral-xyz/anchor";
import { Uint64, uint64ToBigInt } from "../../src/common";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

main(process.argv);

async function main(argv: string[]) {
    const cfgJson = JSON.parse(fs.readFileSync(argv[2], "utf-8"));
    const cfg = new utils.AppConfig(cfgJson);

    const logger = utils.defaultLogger({ label: "auction", level: "debug" });
    logger.info("Start logging");

    const connection = cfg.solanaConnection();

    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT,
    );

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }

    // We play here.
    matchingEngine.onAuctionUpdated(
        await onAuctionUpdateCallback(
            matchingEngine,
            cfg,
            Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64")),
            logger,
        ),
    );
}

type AuctionDetails = {
    slot: bigint;
    fastVaa: PublicKey;
    execute: boolean;
};

class SlotOrderedAuctions {
    private _slots: bigint[];
    private _auctionsPerSlot: Map<bigint, PublicKey[]>;
    private _auctions: Map<string, AuctionDetails>; // stringified pubkeys as keys

    constructor() {
        this._slots = [];
        this._auctionsPerSlot = new Map();
        this._auctions = new Map();
    }

    addAuction(
        endSlot: Uint64,
        accounts: { auction: PublicKey; fastVaa: PublicKey },
        execute: boolean,
    ) {
        const { auction, fastVaa } = accounts;

        // Make sure we do not accidentally execute at the end slot.
        const slot = uint64ToBigInt(endSlot) + 1n;

        if (!this._slots.includes(slot)) {
            // Add then sort slots.
            this._slots.push(slot);
            this._slots.sort();
            // Init new list of pubkeys.
            this._auctionsPerSlot.set(slot, []);
        }
        this._auctionsPerSlot.get(slot)!.push(auction);
        this._auctions.set(auction.toString(), { slot, fastVaa, execute });
    }

    updateAuction(auction: PublicKey, execute: boolean) {
        const key = auction.toString();
        const found = this._auctions.has(key);
        if (found) {
            this._auctions.get(key)!.execute = execute;
        }
        return found;
    }

    headSlot(): bigint | null {
        return this._slots[0] ?? null;
    }

    dequeue(): ({ auction: PublicKey } & AuctionDetails)[] {
        if (this.headSlot() == null) {
            throw new Error("No auctions to dequeue");
        }

        const slot = this._slots.shift()!;
        const details = this._auctionsPerSlot.get(slot)!.map((auction) => {
            const key = auction.toString();
            const details = this._auctions.get(key)!;
            this._auctions.delete(key);
            return { auction, ...details };
        });
        this._auctionsPerSlot.delete(slot);

        return details.filter((deets) => deets.execute);
    }
}

async function onAuctionUpdateCallback(
    matchingEngine: MatchingEngineProgram,
    cfg: utils.AppConfig,
    payer: Keypair,
    logger: winston.Logger,
) {
    const connection = matchingEngine.program.provider.connection;
    const cachedBlockhash = await CachedBlockhash.initialize(
        connection,
        32, // slots
        "finalized",
        logger,
    );

    // Make container that warehouses our auctions per slot.
    const slotOrderedAuctions = new SlotOrderedAuctions();

    connection.onSlotChange(async (slotInfo) => {
        const currentSlot = uint64ToBigInt(slotInfo.slot);
        const headSlot = slotOrderedAuctions.headSlot();
        if (currentSlot === headSlot) {
            const details = slotOrderedAuctions.dequeue();
            logger.debug(
                `current slot: ${currentSlot}, head slot: ${headSlot}, details.len = ${details.length}`,
            );
            for (const deets of details) {
                executeOrderWithRetry(deets);
            }
        }
    });

    async function executeOrderWithRetry(accounts: { auction: PublicKey; fastVaa: PublicKey }) {
        const { auction, fastVaa } = accounts;
        // Execute auction.
        logger.info(
            `Execute with retry, auction: ${auction.toString()}, fastVaa: ${fastVaa.toString()}`,
        );

        let success = false;
        while (!success) {
            success = await matchingEngine
                .executeFastOrderTx(
                    { payer: payer.publicKey, fastVaa, auction },
                    [payer],
                    {
                        feeMicroLamports: 69_420,
                        computeUnits: 290_000,
                    },
                    { skipPreflight: true },
                )
                .then((preppedTx) =>
                    utils.sendTx(connection, preppedTx, logger, cachedBlockhash.latest),
                )
                .then((_) => true)
                .catch((err) => {
                    logger.error(`${err.toString()}`);
                    logger.debug(`Retrying execute order for auction: ${auction.toString()}`);
                    return false;
                });
        }
    }

    // Account for recognized token accounts so we do not offer against "ourselves".
    const ourTokenAccounts = Array.from(cfg.recognizedTokenAccounts());
    for (const ours of ourTokenAccounts) {
        logger.info(`Recognized token account: ${ours.toString()}`);
    }

    logger.info(`Matching Engine: ${matchingEngine.ID.toString()}`);
    return async function (event: AuctionUpdated, slot: number, signature: string) {
        // Do we want to play?
        const { auction, vaa, bestOfferToken, endSlot } = event;

        // Skip if not ours.
        const execute = ourTokenAccounts.find((ours) => ours.equals(bestOfferToken)) !== undefined;

        if (vaa !== null) {
            logger.debug(
                `Add auction: ${auction.toString()}, end slot: ${endSlot}, execute: ${execute}`,
            );
            slotOrderedAuctions.addAuction(endSlot, { auction, fastVaa: vaa }, execute);
        } else {
            logger.debug(
                `Update auction: ${auction.toString()}, end slot: ${endSlot}, execute: ${execute}`,
            );
            slotOrderedAuctions.updateAuction(auction, execute);
        }
    };
}
