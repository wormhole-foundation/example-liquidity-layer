import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { toNative } from "@wormhole-foundation/sdk-definitions";
import { expect } from "chai";
import { ethers } from "ethers";
import { EvmTokenRouter, OrderResponse, decodedOrderResponse } from "../src";
import {
    CircleAttester,
    GuardianNetwork,
    LOCALHOSTS,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    asUniversalBytes,
    burnAllUsdc,
    getSdkSigner,
    mintNativeUsdc,
    parseLiquidityLayerEnvFile,
    signSendMineWait,
    toContractAddresses,
} from "../src/testing";
import { IERC20__factory } from "../src/types";

const CHAIN_PATHWAYS: ValidNetwork[][] = [
    ["Ethereum", "Avalanche"],
    ["Avalanche", "Ethereum"],
    ["Ethereum", "Base"],
    ["Base", "Ethereum"],
    ["Avalanche", "Base"],
    ["Base", "Avalanche"],
];

const TEST_AMOUNT = ethers.parseUnits("1000", 6);

describe("Market Order Business Logic -- CCTP to CCTP", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    const guardianNetwork = new GuardianNetwork();
    const circleAttester = new CircleAttester();

    for (const [fromChainName, toChainName] of CHAIN_PATHWAYS) {
        const localVariables = new Map<string, any>();

        describe(`${fromChainName} <> ${toChainName}`, () => {
            // From setup.
            const fromProvider = new ethers.JsonRpcProvider(LOCALHOSTS[fromChainName]);
            const fromWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[0], fromProvider);
            const fromSigner = getSdkSigner(fromChainName, new ethers.NonceManager(fromWallet));

            const fromEnv = parseLiquidityLayerEnvFile(`${envPath}/${fromChainName}.env`);
            const fromTokenRouter = (() => {
                if (fromEnv.chainType === "Evm") {
                    return new EvmTokenRouter(
                        "Devnet",
                        fromChainName,
                        fromProvider,
                        toContractAddresses(fromEnv),
                    );
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            // To setup.
            const toProvider = new ethers.JsonRpcProvider(LOCALHOSTS[toChainName]);
            const toWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], toProvider);
            const toSigner = getSdkSigner(toChainName, toWallet);

            const toEnv = parseLiquidityLayerEnvFile(`${envPath}/${toChainName}.env`);
            const toTokenRouter = (() => {
                if (toEnv.chainType === "Evm") {
                    return new EvmTokenRouter(
                        "Devnet",
                        toChainName,
                        toProvider,
                        toContractAddresses(toEnv),
                    );
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            before(`From Network -- Mint USDC`, async () => {
                const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                await burnAllUsdc(usdc);

                await mintNativeUsdc(
                    IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                    fromWallet.address,
                    TEST_AMOUNT,
                );
            });

            after(`Burn USDC`, async () => {
                const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                await burnAllUsdc(usdc);
            });

            it(`From Network -- Place Market Order`, async () => {
                const amountIn = await (async () => {
                    if (fromEnv.chainType !== "Evm") throw new Error("Unsupported chain");
                    return await IERC20__factory.connect(
                        fromEnv.tokenAddress,
                        fromWallet,
                    ).balanceOf(fromWallet.address);
                })();
                localVariables.set("amountIn", amountIn);

                const order: TokenRouter.OrderRequest = {
                    amountIn,
                    minAmountOut: BigInt(0),
                    redeemer: toNative("Ethereum", toWallet.address).toUniversalAddress(),
                    targetChain: toChainName,
                };

                const txs = fromTokenRouter.placeMarketOrder(fromWallet.address, order);
                const receipt = await signSendMineWait(txs, fromSigner);
                const transactionResult = await fromTokenRouter.getTransactionResults(
                    receipt!.hash,
                );

                expect(transactionResult.wormhole.emitterAddress).to.eql(
                    asUniversalBytes(fromEnv.tokenRouterAddress),
                );
                expect(transactionResult.wormhole.message.body).has.property("fill");
                expect(transactionResult.circleMessage).is.not.undefined;

                const fillVaa = await guardianNetwork.observeEvm(
                    fromProvider,
                    fromChainName,
                    receipt!,
                );

                const circleBridgeMessage = transactionResult.circleMessage!;
                const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                const orderResponse: OrderResponse = {
                    encodedWormholeMessage: fillVaa,
                    circleBridgeMessage,
                    circleAttestation,
                };
                localVariables.set("orderResponse", orderResponse);
            });

            it(`To Network -- Redeem Fill`, async () => {
                const orderResponse = localVariables.get("orderResponse") as OrderResponse;
                expect(localVariables.delete("orderResponse")).is.true;

                const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                const balanceBefore = await usdc.balanceOf(toWallet.address);

                const { vaa, cctp } = decodedOrderResponse(orderResponse);
                const txs = toTokenRouter.redeemFill(toWallet.address, vaa, cctp);
                await signSendMineWait(txs, toSigner);

                const balanceAfter = await usdc.balanceOf(toWallet.address);

                expect((balanceAfter - balanceBefore).toString()).to.eql(
                    localVariables.get("amountIn").toString(),
                );
                expect(localVariables.delete("amountIn")).is.true;
            });
        });
    }
});
