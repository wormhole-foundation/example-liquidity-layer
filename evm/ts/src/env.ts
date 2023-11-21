import { parse as envParse } from "envfile";
import * as fs from "fs";

export enum ChainType {
    Evm,
    Solana,
}

export type LiquidityLayerEnv = {
    chainType: ChainType;
    chainId: number;
    tokenAddress: string;
    wormholeCctpAddress: string;
    ownerAssistantAddress: string;
    tokenRouterAddress: string;
    feeRecipient?: string;
    matchingEngineChain: string;
    matchingEngineAddress: string;
};

export function parseLiquidityLayerEnvFile(envPath: string): LiquidityLayerEnv {
    if (!fs.existsSync(envPath)) {
        throw new Error(`${envPath} non-existent`);
    }

    const raw = fs.readFileSync(envPath, "utf8");
    const contents = envParse(raw.replace(/export RELEASE_/g, ""));

    const keys = [
        "CHAIN_TYPE",
        "CHAIN_ID",
        "TOKEN_ADDRESS",
        "WORMHOLE_CCTP_ADDRESS",
        "OWNER_ASSISTANT_ADDRESS",
        "TOKEN_ROUTER_ADDRESS",
        "FEE_RECIPIENT",
        "MATCHING_ENGINE_CHAIN",
        "MATCHING_ENGINE_ADDRESS",
    ];
    for (const key of keys) {
        if (!contents[key] && key != "FEE_RECIPIENT") {
            throw new Error(`no ${key}`);
        }
    }

    return {
        chainType: parseChainType(contents.CHAIN_TYPE),
        chainId: parseInt(contents.CHAIN_ID),
        tokenAddress: contents.TOKEN_ADDRESS,
        wormholeCctpAddress: contents.WORMHOLE_CCTP_ADDRESS,
        ownerAssistantAddress: contents.OWNER_ASSISTANT_ADDRESS,
        tokenRouterAddress: contents.TOKEN_ROUTER_ADDRESS,
        feeRecipient: contents.FEE_RECIPIENT,
        matchingEngineChain: contents.MATCHING_ENGINE_CHAIN,
        matchingEngineAddress: contents.MATCHING_ENGINE_ADDRESS,
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
