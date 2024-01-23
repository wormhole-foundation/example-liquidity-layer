import {
    CHAIN_ID_AVAX,
    coalesceChainId,
    tryHexToNativeAssetString,
    tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { ITokenRouter__factory, IMatchingEngine__factory } from "../src/types";
import {
    LOCALHOSTS,
    OWNER_ASSISTANT_PRIVATE_KEY,
    mineWait,
    ValidNetwork,
    MATCHING_ENGINE_NAME,
} from "./helpers";
import { expect } from "chai";

import { parseLiquidityLayerEnvFile, ChainType, LiquidityLayerEnv } from "../src";

const CHAIN_PATHWAYS: ValidNetwork[] = ["ethereum", "avalanche", "arbitrum"];

describe("Registration", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    describe(`Register Token Routers on ${MATCHING_ENGINE_NAME} Matching Engine`, () => {
        const env = parseLiquidityLayerEnvFile(`${envPath}/${MATCHING_ENGINE_NAME}.env`);
        const provider = new ethers.providers.StaticJsonRpcProvider(
            LOCALHOSTS[MATCHING_ENGINE_NAME]
        );
        const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);
        const engine = IMatchingEngine__factory.connect(
            tryHexToNativeAssetString(env.matchingEngineAddress, CHAIN_ID_AVAX),
            assistant
        );

        for (const chainName of CHAIN_PATHWAYS) {
            it(`Register ${chainName}`, async () => {
                const targetEnv = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);
                const [formattedAddress, mintRecipient] = fetchTokenRouterEndpoint(
                    targetEnv,
                    chainName
                );
                const targetChainId = coalesceChainId(chainName);
                await engine
                    .addRouterEndpoint(targetChainId, {
                        router: formattedAddress,
                        mintRecipient,
                    })
                    .then((tx) => mineWait(provider, tx));

                const registeredAddress = await engine.getRouter(targetChainId);
                expect(registeredAddress.substring(2)).to.equal(
                    Buffer.from(formattedAddress).toString("hex")
                );
            });
        }
    });

    for (const chainName of CHAIN_PATHWAYS) {
        describe(`Register Token Routers on ${chainName}`, () => {
            const env = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);
            const provider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS[chainName]);
            const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);
            const router = ITokenRouter__factory.connect(env.tokenRouterAddress, assistant);

            for (const targetChain of CHAIN_PATHWAYS) {
                if (targetChain === chainName) {
                    continue;
                }

                it(`Register ${targetChain}`, async () => {
                    const targetEnv = parseLiquidityLayerEnvFile(`${envPath}/${targetChain}.env`);
                    const [formattedAddress, mintRecipient] = fetchTokenRouterEndpoint(
                        targetEnv,
                        chainName
                    );
                    const targetChainId = coalesceChainId(targetChain);
                    await router
                        .addRouterEndpoint(
                            targetChainId,
                            { router: formattedAddress, mintRecipient },
                            targetEnv.domain
                        )
                        .then((tx) => mineWait(provider, tx));

                    const registeredAddress = await router.getRouter(targetChainId);
                    expect(registeredAddress.substring(2)).to.equal(
                        Buffer.from(formattedAddress).toString("hex")
                    );
                });
            }
        });
    }
});

function fetchTokenRouterEndpoint(
    targetEnv: LiquidityLayerEnv,
    chainName: ValidNetwork
): [Uint8Array, Uint8Array] {
    const formattedAddress = tryNativeToUint8Array(targetEnv.tokenRouterAddress, chainName);
    let formattedMintRecipient;
    if (targetEnv.chainType === ChainType.Evm) {
        formattedMintRecipient = formattedAddress;
    } else {
        if (targetEnv.tokenRouterMintRecipient === undefined) {
            throw new Error("no token router mint recipient specified");
        } else {
            formattedMintRecipient = tryNativeToUint8Array(
                targetEnv.tokenRouterMintRecipient,
                chainName
            );
        }
    }
    return [formattedAddress, formattedMintRecipient];
}
