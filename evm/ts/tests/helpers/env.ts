import { parse as envParse } from "envfile";
import * as fs from "fs";

export enum ChainType {
    Evm,
    Solana,
}

export type LiquidityLayerEnv = {
    chainType: ChainType;
    chainId: number;
    domain: number;
    tokenAddress: string;
    wormholeAddress: string;
    tokenMessengerAddress: string;
    ownerAssistantAddress: string;
    tokenRouterAddress: string;
    tokenRouterMintRecipient?: string;
    feeRecipient?: string;
    matchingEngineChain: string;
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
        matchingEngineChain: contents.MATCHING_ENGINE_CHAIN,
        matchingEngineAddress: contents.MATCHING_ENGINE_ADDRESS,
        matchingEngineMintRecipient: contents.MATCHING_ENGINE_MINT_RECIPIENT,
        matchingEngineDomain: contents.MATCHING_ENGINE_DOMAIN,
    };
}

function parseChainType(chainType: string) {
    switch (chainType) {
        case "evm": {
            return ChainType.Evm;
        }
        case "solana": {
            return ChainType.Solana;
        }
        default: {
            throw new Error(`invalid chain type: ${chainType}`);
        }
    }
}
