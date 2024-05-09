import { ethers } from "ethers";
import { ITokenRouter__factory, IMatchingEngine__factory } from "../src/types";
import {
    LOCALHOSTS,
    OWNER_ASSISTANT_PRIVATE_KEY,
    mineWait,
    ValidNetwork,
    MATCHING_ENGINE_NAME,
    parseLiquidityLayerEnvFile,
    ChainType,
    LiquidityLayerEnv,
} from "./helpers";
import { expect } from "chai";
import { toChainId, toNative, toUniversal } from "@wormhole-foundation/sdk";

const CHAIN_PATHWAYS: ValidNetwork[] = ["Ethereum", "Avalanche", "Base"];

describe("Registration", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    describe(`Register Token Routers on ${MATCHING_ENGINE_NAME} Matching Engine`, () => {
        const env = parseLiquidityLayerEnvFile(
            `${envPath}/${MATCHING_ENGINE_NAME.toLowerCase()}.env`,
        );
        const provider = new ethers.providers.StaticJsonRpcProvider(
            LOCALHOSTS[MATCHING_ENGINE_NAME],
        );
        const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);

        const matchingEngineAddress = toUniversal("Avalanche", env.matchingEngineAddress).toNative(
            "Avalanche",
        );
        const engine = IMatchingEngine__factory.connect(
            matchingEngineAddress.toString(),
            assistant,
        );

        for (const chainName of CHAIN_PATHWAYS) {
            it(`Register ${chainName}`, async () => {
                const targetEnv = parseLiquidityLayerEnvFile(
                    `${envPath}/${chainName.toLowerCase()}.env`,
                );
                const [formattedAddress, mintRecipient] = fetchTokenRouterEndpoint(
                    targetEnv,
                    chainName,
                );
                const targetChainId = toChainId(chainName);
                await engine
                    .addRouterEndpoint(
                        targetChainId,
                        {
                            router: formattedAddress,
                            mintRecipient,
                        },
                        targetEnv.domain,
                    )
                    .then((tx) => mineWait(provider, tx));

                const registeredAddress = await engine.getRouter(targetChainId);
                expect(registeredAddress.substring(2)).to.equal(
                    Buffer.from(formattedAddress).toString("hex"),
                );
            });
        }
    });

    for (const chainName of CHAIN_PATHWAYS) {
        describe(`Register Token Routers on ${chainName}`, () => {
            const env = parseLiquidityLayerEnvFile(`${envPath}/${chainName.toLowerCase()}.env`);
            const provider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS[chainName]);
            const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);
            const router = ITokenRouter__factory.connect(env.tokenRouterAddress, assistant);

            for (const targetChain of CHAIN_PATHWAYS) {
                if (targetChain === chainName) {
                    continue;
                }

                it(`Register ${targetChain}`, async () => {
                    const targetEnv = parseLiquidityLayerEnvFile(
                        `${envPath}/${targetChain.toLowerCase()}.env`,
                    );
                    const [formattedAddress, mintRecipient] = fetchTokenRouterEndpoint(
                        targetEnv,
                        chainName,
                    );
                    const targetChainId = toChainId(targetChain);
                    await router
                        .addRouterEndpoint(
                            targetChainId,
                            { router: formattedAddress, mintRecipient },
                            targetEnv.domain,
                        )
                        .then((tx) => mineWait(provider, tx));

                    const registeredAddress = await router.getRouter(targetChainId);
                    expect(registeredAddress.substring(2)).to.equal(
                        Buffer.from(formattedAddress).toString("hex"),
                    );
                });
            }
        });
    }
});

function fetchTokenRouterEndpoint(
    targetEnv: LiquidityLayerEnv,
    chainName: ValidNetwork,
): [Uint8Array, Uint8Array] {
    const formattedAddress = toUniversal(chainName, targetEnv.tokenRouterAddress).toUint8Array();
    let formattedMintRecipient;
    if (targetEnv.chainType === ChainType.Evm) {
        formattedMintRecipient = formattedAddress;
    } else {
        if (targetEnv.tokenRouterMintRecipient === undefined) {
            throw new Error("no token router mint recipient specified");
        } else {
            formattedMintRecipient = toUniversal(
                chainName,
                targetEnv.tokenRouterMintRecipient,
            ).toUint8Array();
        }
    }
    return [formattedAddress, formattedMintRecipient];
}
