import {
    ChainName,
    coalesceChainId,
    tryNativeToUint8Array,
    tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const CHAINS: ChainName[] = [
    "sepolia",
    "avalanche",
    "optimism_sepolia",
    "arbitrum_sepolia",
    "base_sepolia",
    "polygon",
];

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    console.log("Collecting Solana Matching Engine and Token Router Info...");
    console.log();
    {
        const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(
            connection,
            matchingEngineSdk.testnet(),
            USDC_MINT
        );

        const custodian = matchingEngine.custodianAddress();
        console.log(`Matching Engine Custodian: ${custodian.toString()}`);
        console.log();
        console.log("NOTE: The Custodian's address is the Matching Engine's emitter.");
        console.log(`Emitter Address: ${custodian.toBuffer().toString("hex")}`);
        console.log();

        const custodyToken = matchingEngine.custodyTokenAccountAddress();
        console.log(`Matching Engine Custody Token: ${custodyToken.toString()}`);
        console.log();
        console.log(
            "NOTE: The Custody Token Account's address is the Matching Engine's mint recipient."
        );
        console.log(`Mint Recipient Address: ${custodyToken.toBuffer().toString("hex")}`);
        console.log();

        const custodianData = await matchingEngine.fetchCustodian();
        console.log("Custodian Data");
        console.log(JSON.stringify(custodianData, null, 2));
        console.log();

        const auctionConfig = await matchingEngine.fetchAuctionConfig(
            custodianData.auctionConfigId
        );
        console.log("Auction Config Data");
        console.log(JSON.stringify(auctionConfig, null, 2));
        console.log();

        for (const chainName of CHAINS) {
            const chain = coalesceChainId(chainName);
            const endpointData = await matchingEngine.fetchRouterEndpoint(chain);
            console.log(`Router Endpoint: ${chainName} (${chain})`);
            console.log(stringifyEndpoint(chainName, endpointData));
            console.log();
        }
    }

    {
        const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
            connection,
            tokenRouterSdk.testnet(),
            USDC_MINT
        );

        const custodian = tokenRouter.custodianAddress();
        console.log(`Token Router Custodian: ${custodian.toString()}`);
        console.log();
        console.log("NOTE: The Custodian's address is the Token Router's emitter.");
        console.log(`Emitter Address: ${custodian.toBuffer().toString("hex")}`);
        console.log();

        const custodyToken = tokenRouter.custodyTokenAccountAddress();
        console.log(`Token Router Custody Token: ${custodyToken.toString()}`);
        console.log();
        console.log(
            "NOTE: The Custody Token Account's address is the Token Router's mint recipient."
        );
        console.log(`Mint Recipient Address: ${custodyToken.toBuffer().toString("hex")}`);
        console.log();
    }
}

function stringifyEndpoint(chainName: ChainName, endpoint: matchingEngineSdk.RouterEndpoint) {
    const out = {
        address: tryUint8ArrayToNative(Uint8Array.from(endpoint.address), chainName),
        mintRecipient: tryUint8ArrayToNative(Uint8Array.from(endpoint.mintRecipient), chainName),
        protocol: endpoint.protocol,
    };
    return JSON.stringify(out, null, 2);
}
