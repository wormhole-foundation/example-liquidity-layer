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
            USDC_MINT,
        );

        const custodian = matchingEngine.custodianAddress();
        console.log("Matching Engine");
        console.log("  Custodian (NOTE: The Custodian's address is the program's emitter):");
        console.log(`    Native:    ${custodian.toString()}`);
        console.log(`    Universal: ${custodian.toBuffer().toString("hex")}`);
        console.log();

        const cctpMintRecipient = matchingEngine.cctpMintRecipientAddress();
        console.log("  Mint Recipient:");
        console.log(`    Native:    ${cctpMintRecipient.toString()}`);
        console.log(`    Universal: ${cctpMintRecipient.toBuffer().toString("hex")}`);
        console.log();

        const custodianData = await matchingEngine.fetchCustodian();
        console.log("Custodian Data");
        console.log(JSON.stringify(custodianData, null, 2));
        console.log();

        const auctionConfig = await matchingEngine.fetchAuctionConfig(
            custodianData.auctionConfigId,
        );
        console.log("Auction Config Data");
        console.log(JSON.stringify(auctionConfig, null, 2));
        console.log();

        for (const chainName of CHAINS) {
            await matchingEngine
                .fetchRouterEndpoint(coalesceChainId(chainName))
                .then((endpointData) => {
                    console.log(
                        `Registered Endpoint (${chainName}): ${stringifyEndpoint(
                            chainName,
                            endpointData,
                        )}`,
                    );
                })
                .catch((_) => {
                    console.log(`Not Registered: ${chainName}`);
                });
            console.log();
        }
    }

    {
        const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
            connection,
            tokenRouterSdk.testnet(),
            USDC_MINT,
        );

        const custodian = tokenRouter.custodianAddress();
        console.log(`Token Router`);
        console.log("  Custodian (NOTE: The Custodian's address is the program's emitter):");
        console.log(`    Native:    ${custodian.toString()}`);
        console.log(`    Universal: ${custodian.toBuffer().toString("hex")}`);
        console.log();

        const cctpMintRecipient = tokenRouter.cctpMintRecipientAddress();
        console.log("  Mint Recipient:");
        console.log(`    Native:    ${cctpMintRecipient.toString()}`);
        console.log(`    Universal: ${cctpMintRecipient.toBuffer().toString("hex")}`);
        console.log();
    }
}

function stringifyEndpoint(chainName: ChainName, endpoint: matchingEngineSdk.RouterEndpoint) {
    const out = {
        address: tryUint8ArrayToNative(Uint8Array.from(endpoint.info.address), chainName),
        mintRecipient: tryUint8ArrayToNative(Uint8Array.from(endpoint.info.mintRecipient), chainName),
        protocol: endpoint.info.protocol,
    };
    return JSON.stringify(out, null, 2);
}
