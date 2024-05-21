import { Connection, PublicKey } from "@solana/web3.js";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";

const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const CHAINS: Chain[] = [
    "Sepolia",
    "Avalanche",
    "OptimismSepolia",
    "ArbitrumSepolia",
    "BaseSepolia",
    "PolygonSepolia",
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
                .fetchRouterEndpointInfo(toChainId(chainName))
                .then((endpointData) => {
                    console.log(
                        `Registered Endpoint (${chainName}): ${stringifyEndpoint(
                            chainName,
                            endpointData,
                        )}`,
                    );
                })
                .catch((err) => {
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

function stringifyEndpoint(chain: Chain, endpoint: matchingEngineSdk.EndpointInfo) {
    const out = {
        address: toUniversal(chain, Uint8Array.from(endpoint.address)).toNative(chain).toString(),
        mintRecipient: toUniversal(chain, Uint8Array.from(endpoint.mintRecipient))
            .toNative(chain)
            .toString(),
        protocol: endpoint.protocol,
    };
    return JSON.stringify(out, null, 2);
}
