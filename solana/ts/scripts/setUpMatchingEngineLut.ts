import {
    AddressLookupTableProgram,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram } from "../src/matchingEngine";
import { CHAINS } from "./getTestnetInfo";
import { toChainId } from "@wormhole-foundation/sdk-base";

const PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

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

    // const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
    //     AddressLookupTableProgram.createLookupTable({
    //         authority: payer.publicKey,
    //         payer: payer.publicKey,
    //         recentSlot: slot,
    //     }),
    // );

    // const createTx = await sendAndConfirmTransaction(connection, new Transaction().add(createIx), [
    //     payer,
    // ]);
    // console.log("createTx", createTx);

    const lookupTable = new PublicKey("DaZU4eDFxq8hAHf78HLUyhWe8G2tszyaNUJoFgDCqqs8");

    const usdcCommonAccounts = await matchingEngine.commonAccounts();

    const addresses = [
        ...Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
        payer.publicKey,
    ];

    const uniqueAddresses = new Map<string, PublicKey>();

    for (const chainName of CHAINS) {
        const { protocol } = await matchingEngine.fetchRouterEndpointInfo(toChainId(chainName));

        if (protocol.cctp?.domain === undefined) {
            console.warn(`Couldn't find cctp domain for ${chainName}`);
            continue;
        }
        const { remoteTokenMessenger, tokenMessengerMinterEventAuthority } = await matchingEngine
            .tokenMessengerMinterProgram()
            .depositForBurnWithCallerAccounts(matchingEngine.mint, protocol.cctp?.domain);

        uniqueAddresses.set(remoteTokenMessenger.toBase58(), remoteTokenMessenger);
        // Note: Some of the tokenMessengerMinterEventAuthority addresses are the same across cctp domains.
        uniqueAddresses.set(
            tokenMessengerMinterEventAuthority.toBase58(),
            tokenMessengerMinterEventAuthority,
        );
    }

    addresses.push(...Array.from(uniqueAddresses.values()));

    // Extend.
    const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable,
        addresses,
    });

    const extendTx = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(extendIx),
        [payer],
        {
            commitment: "finalized",
        },
    );
    console.log("extendTx", extendTx);
}
