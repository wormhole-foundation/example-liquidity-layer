import { ChainName, coalesceChainId, tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
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
    minOfferDelta: 50000, // 5%
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
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "hex"));

    // Set up program.
    await intialize(matchingEngine, payer);

    // Add endpoints.
    //
    // CCTP Domains listed here: https://developers.circle.com/stablecoins/docs/supported-domains.
    {
        // https://sepolia.etherscan.io/address/0x603541d1Cf7178C407aA7369b67CB7e0274952e2
        const foreignChain = "sepolia";
        const foreignEmitter = "0x603541d1Cf7178C407aA7369b67CB7e0274952e2";
        const cctpDomain = 0;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://testnet.snowtrace.io/address/0x7353B29FDc79435dcC7ECc9Ac9F9b61d83B4E0F4
        const foreignChain = "avalanche";
        const foreignEmitter = "0x7353B29FDc79435dcC7ECc9Ac9F9b61d83B4E0F4";
        const cctpDomain = 1;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia-optimism.etherscan.io/address/0xc1Cf3501ef0b26c8A47759F738832563C7cB014A
        const foreignChain = "optimism_sepolia";
        const foreignEmitter = "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A";
        const cctpDomain = 2;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia.arbiscan.io/address/0xc1cf3501ef0b26c8a47759f738832563c7cb014a
        const foreignChain = "arbitrum_sepolia";
        const foreignEmitter = "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A";
        const cctpDomain = 3;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia.basescan.org/address/0x4452b708c01d6ad7058a7541a3a82f0ad0a1abb1
        const foreignChain = "base_sepolia";
        const foreignEmitter = "0x4452B708C01d6aD7058a7541A3A82f0aD0A1abB1";
        const cctpDomain = 6;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://mumbai.polygonscan.com/address/0x3Ce8a3aC230Eb4bCE3688f2A1ab21d986a0A0B06
        const foreignChain = "polygon";
        const foreignEmitter = "0x3Ce8a3aC230Eb4bCE3688f2A1ab21d986a0A0B06";
        const cctpDomain = 7;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
}

async function intialize(matchingEngine: MatchingEngineProgram, payer: Keypair) {
    const connection = matchingEngine.program.provider.connection;

    const custodian = matchingEngine.custodianAddress();
    console.log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        console.log("already initialized");
        return;
    }

    const ix = await matchingEngine.initializeIx(
        {
            owner: payer.publicKey,
            ownerAssistant: payer.publicKey,
            feeRecipient: payer.publicKey,
        },
        AUCTION_PARAMS,
    );

    await splToken.getOrCreateAssociatedTokenAccount(connection, payer, USDC_MINT, payer.publicKey);

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
        .catch((err) => {
            console.log(err.logs);
            throw err;
        })
        .then((txSig) => {
            console.log("intialize", txSig);
        });
}

async function addCctpRouterEndpoint(
    matchingEngine: MatchingEngineProgram,
    payer: Keypair,
    foreignChain: ChainName,
    cctpDomain: number,
    foreignEmitter: string,
    foreignMintRecipient: string | null,
) {
    await matchingEngine.fetchCustodian().catch((_) => {
        throw new Error("no custodian found");
    });

    const connection = matchingEngine.program.provider.connection;

    const chain = coalesceChainId(foreignChain);
    const endpoint = matchingEngine.routerEndpointAddress(chain);
    const exists = await connection.getAccountInfo(endpoint).then((acct) => acct != null);

    const endpointAddress = Array.from(tryNativeToUint8Array(foreignEmitter, foreignChain));
    const endpointMintRecipient =
        foreignMintRecipient === null
            ? null
            : Array.from(tryNativeToUint8Array(foreignMintRecipient, foreignChain));

    if (exists) {
        const { address, mintRecipient } = await matchingEngine.fetchRouterEndpoint(chain);
        if (
            Buffer.from(address).equals(Buffer.from(endpointAddress)) &&
            Buffer.from(mintRecipient).equals(Buffer.from(endpointMintRecipient ?? endpointAddress))
        ) {
            console.log(
                "endpoint already exists",
                foreignChain,
                "addr",
                foreignEmitter,
                "domain",
                cctpDomain,
                "mintRecipient",
                foreignMintRecipient,
            );
            return;
        }
    }

    const ix = await matchingEngine.addCctpRouterEndpointIx(
        {
            ownerOrAssistant: payer.publicKey,
        },
        {
            chain,
            address: endpointAddress,
            mintRecipient: endpointMintRecipient,
            cctpDomain,
        },
    );
    const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
    console.log(
        "added endpoint",
        txSig,
        "chain",
        foreignChain,
        "addr",
        foreignEmitter,
        "domain",
        cctpDomain,
        "mintRecipient",
        foreignMintRecipient,
    );
}
