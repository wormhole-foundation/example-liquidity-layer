import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Platform, toChain } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
//@ts-ignore
import { parse as envParse } from "envfile";
import * as fs from "fs";

export type LiquidityLayerEnv = {
    chainType: Platform;
    chainId: number;
    domain: number;
    tokenAddress: string;
    wormholeAddress: string;
    tokenMessengerAddress: string;
    ownerAssistantAddress: string;
    tokenRouterAddress: string;
    tokenRouterMintRecipient?: string;
    feeRecipient?: string;
    matchingEngineChain: Chain;
    matchingEngineAddress: string;
    matchingEngineMintRecipient: string;
    matchingEngineDomain?: string;
};

export function parseLiquidityLayerEnvFile(envPath: string): LiquidityLayerEnv {
    if (!fs.existsSync(envPath)) {
        console.log(envPath);
        throw new Error(`${envPath} non-existent`);
    }

    const raw = fs.readFileSync(envPath, "utf8");
    const contents = envParse(raw.replace(/export RELEASE_/g, ""));

    const keys = [
        "CHAIN_TYPE",
        "CHAIN_ID",
        "DOMAIN",
        "TOKEN_ADDRESS",
        "WORMHOLE_ADDRESS",
        "TOKEN_MESSENGER_ADDRESS",
        "OWNER_ASSISTANT_ADDRESS",
        "TOKEN_ROUTER_ADDRESS",
        "TOKEN_ROUTER_MINT_RECIPIENT",
        "FEE_RECIPIENT_ADDRESS",
        "MATCHING_ENGINE_CHAIN",
        "MATCHING_ENGINE_ADDRESS",
        "MATCHING_ENGINE_MINT_RECIPIENT",
        "MATCHING_ENGINE_DOMAIN",
    ];
    for (const key of keys) {
        if (
            !contents[key] &&
            key != "FEE_RECIPIENT_ADDRESS" &&
            key != "TOKEN_ROUTER_MINT_RECIPIENT"
        ) {
            throw new Error(`no ${key}`);
        }
    }

    return {
        chainType: parseChainType(contents.CHAIN_TYPE),
        chainId: parseInt(contents.CHAIN_ID),
        domain: parseInt(contents.DOMAIN),
        tokenAddress: contents.TOKEN_ADDRESS,
        wormholeAddress: contents.WORMHOLE_ADDRESS,
        tokenMessengerAddress: contents.TOKEN_MESSENGER_ADDRESS,
        ownerAssistantAddress: contents.OWNER_ASSISTANT_ADDRESS,
        tokenRouterAddress: contents.TOKEN_ROUTER_ADDRESS,
        tokenRouterMintRecipient: contents.TOKEN_ROUTER_MINT_RECIPIENT,
        feeRecipient: contents.FEE_RECIPIENT_ADDRESS,
        matchingEngineChain: toChain(parseInt(contents.MATCHING_ENGINE_CHAIN)),
        matchingEngineAddress: contents.MATCHING_ENGINE_ADDRESS,
        matchingEngineMintRecipient: contents.MATCHING_ENGINE_MINT_RECIPIENT,
        matchingEngineDomain: contents.MATCHING_ENGINE_DOMAIN,
    };
}

export function toContractAddresses(env: LiquidityLayerEnv): TokenRouter.Addresses {
    return {
        tokenRouter: env.tokenRouterAddress,
        matchingEngine: toUniversal(env.matchingEngineChain, env.matchingEngineAddress)
            .toNative(env.matchingEngineChain)
            .toString(),
        coreBridge: env.wormholeAddress,
        cctp: {
            tokenMessenger: env.tokenMessengerAddress,
            usdcMint: env.tokenAddress,
            // TODO: needed?
            messageTransmitter: "",
            wormhole: "",
            wormholeRelayer: "",
        },
    };
}

function parseChainType(chainType: string) {
    switch (chainType) {
        case "evm":
            return "Evm";
        case "solana":
            return "Solana";
        default:
            throw new Error(`invalid chain type: ${chainType}`);
    }
}
