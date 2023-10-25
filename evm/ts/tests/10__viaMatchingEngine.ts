import {
    coalesceChainId,
    parseTokenTransferVaa,
    tryNativeToUint8Array,
    tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { expect } from "chai";
import { ethers } from "ethers";
import {
    ChainType,
    EvmOrderRouter,
    Fill,
    MarketOrder,
    MessageDecoder,
    OrderResponse,
    TokenType,
    errorDecoder,
    LiquidityLayerTransactionResult,
    parseLiquidityLayerEnvFile,
} from "../src";
import {
    ICircleIntegration__factory,
    IERC20__factory,
    IMatchingEngine__factory,
} from "../src/types";
import {
    CircleAttester,
    GuardianNetwork,
    LOCALHOSTS,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    burnAllUsdc,
    mineWait,
    mintNativeUsdc,
} from "./helpers";

const CHAIN_PATHWAYS: ValidNetwork[][] = [
    ["avalanche", "bsc"],
    ["avalanche", "moonbeam"],
    ["ethereum", "bsc"],
];

const PING_PONG_AMOUNT = ethers.utils.parseUnits("1000", 6);

describe("Ping Pong -- via Matching Engine", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    // Avalanche setup for Matching Engine.
    const matchingEngineEnv = parseLiquidityLayerEnvFile(`${envPath}/avalanche.env`);
    const matchingEngineAddress = tryUint8ArrayToNative(
        ethers.utils.arrayify(matchingEngineEnv.matchingEngineEndpoint),
        "avalanche"
    );
    const meProvider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS.avalanche);

    const relayer = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], meProvider);
    const matchingEngine = IMatchingEngine__factory.connect(matchingEngineAddress, relayer);

    const guardianNetwork = new GuardianNetwork();
    const circleAttester = new CircleAttester();

    for (const [pingChainName, pongChainName] of CHAIN_PATHWAYS) {
        const localVariables = new Map<string, any>();

        describe(`${pingChainName} <> ${pongChainName}`, () => {
            // Ping setup.
            const pingProvider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[pingChainName]
            );
            const pingWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[0], pingProvider);

            const pingEnv = parseLiquidityLayerEnvFile(`${envPath}/${pingChainName}.env`);
            const pingOrderRouter = (() => {
                if (pingEnv.chainType === ChainType.Evm) {
                    return new EvmOrderRouter(pingWallet, pingEnv.orderRouterAddress);
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            // Pong setup.
            const pongProvider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[pongChainName]
            );
            const pongWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[0], pongProvider);

            const pongEnv = parseLiquidityLayerEnvFile(`${envPath}/${pongChainName}.env`);
            const pongOrderRouter = (() => {
                if (pongEnv.chainType === ChainType.Evm) {
                    return new EvmOrderRouter(pongWallet, pongEnv.orderRouterAddress);
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            if (pingChainName == "avalanche" || pingChainName == "ethereum") {
                before(`Ping Network -- Mint USDC`, async () => {
                    const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(pingEnv.tokenAddress, pingProvider),
                        pingWallet.address,
                        PING_PONG_AMOUNT
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingWallet);
                    await burnAllUsdc(usdc);
                });
            } else {
                throw new Error("Test misconfigured");
            }

            it(`Ping Network -- Place Market Order`, async () => {
                const amountIn = await (async () => {
                    if (pingEnv.chainType == ChainType.Evm) {
                        const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingWallet);
                        const amount = await usdc.balanceOf(pingWallet.address);
                        await usdc
                            .approve(pingOrderRouter.address, amount)
                            .then((tx) => mineWait(pingProvider, tx));

                        return BigInt(amount.toString());
                    } else {
                        throw new Error("Unsupported chain");
                    }
                })();

                const targetChain = coalesceChainId(pongChainName);

                const receipt = await pingOrderRouter
                    .computeMinAmountOut(amountIn, targetChain)
                    .then((minAmountOut) =>
                        pingOrderRouter.placeMarketOrder({
                            amountIn,
                            minAmountOut,
                            targetChain,
                            redeemer: Buffer.from(
                                tryNativeToUint8Array(pongWallet.address, pongChainName)
                            ),
                            redeemerMessage: Buffer.from("All your base are belong to us."),
                            refundAddress: pingWallet.address,
                        })
                    )
                    .then((tx) => mineWait(pingProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const transactionResult = await pingOrderRouter.getTransactionResults(
                    receipt.transactionHash
                );

                const possiblyOrderVaa = await guardianNetwork.observeEvm(
                    pingProvider,
                    pingChainName,
                    receipt
                );

                if (pingChainName == "avalanche") {
                    expect(transactionResult.wormhole.message.body).has.property("fill");

                    const [circleBridgeMessage, circleAttestation] = (() => {
                        if (transactionResult.circleMessage !== undefined) {
                            const circleBridgeMessage = transactionResult.circleMessage;
                            return [
                                circleBridgeMessage,
                                circleAttester.createAttestation(circleBridgeMessage),
                            ];
                        } else {
                            return [Buffer.alloc(0), Buffer.alloc(0)];
                        }
                    })();

                    const orderResponse: OrderResponse = {
                        encodedWormholeMessage: possiblyOrderVaa,
                        circleBridgeMessage,
                        circleAttestation,
                    };

                    localVariables.set("orderResponse", orderResponse);
                } else {
                    expect(transactionResult.wormhole.message.body).has.property("marketOrder");

                    if (transactionResult.circleMessage !== undefined) {
                        const circleBridgeMessage = transactionResult.circleMessage;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        localVariables.set("circleBridgeMessage", circleBridgeMessage);
                        localVariables.set("circleAttestation", circleAttestation);
                    }

                    localVariables.set("orderVaa", possiblyOrderVaa);
                }
            });

            if (pingChainName != "avalanche") {
                it(`Matching Engine -- Relay Order`, async () => {
                    expect(localVariables.has("orderResponse")).is.false;

                    const orderVaa = localVariables.get("orderVaa") as Buffer;
                    expect(localVariables.delete("orderVaa")).is.true;

                    const receipt = await (async () => {
                        if (pingEnv.chainType === ChainType.Evm) {
                            if (localVariables.has("circleBridgeMessage")) {
                                const circleBridgeMessage = localVariables.get(
                                    "circleBridgeMessage"
                                ) as Buffer;
                                localVariables.delete("circleBridgeMessage");

                                const circleAttestation = localVariables.get(
                                    "circleAttestation"
                                ) as Buffer;
                                expect(localVariables.delete("circleAttestation")).is.true;

                                return matchingEngine["executeOrder((bytes,bytes,bytes))"]({
                                    encodedWormholeMessage: orderVaa,
                                    circleBridgeMessage,
                                    circleAttestation,
                                });
                            } else {
                                return matchingEngine["executeOrder(bytes)"](orderVaa);
                            }
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })().then((tx) => mineWait(meProvider, tx));

                    const fillVaa = await guardianNetwork.observeEvm(
                        meProvider,
                        "avalanche",
                        receipt
                    );

                    const wormholeCctp = ICircleIntegration__factory.connect(
                        matchingEngineEnv.wormholeCctpAddress,
                        meProvider
                    );
                    const transactionResult = await Promise.all([
                        wormholeCctp.wormhole(),
                        wormholeCctp.circleTransmitter(),
                    ]).then(([coreBridgeAddress, circleTransmitterAddress]) =>
                        LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
                            "avalanche",
                            coreBridgeAddress,
                            wormholeCctp.address,
                            receipt,
                            circleTransmitterAddress
                        )
                    );
                    expect(transactionResult.wormhole.message.body).has.property("fill");

                    const [circleBridgeMessage, circleAttestation] = (() => {
                        if (transactionResult.circleMessage !== undefined) {
                            const circleBridgeMessage = transactionResult.circleMessage;
                            return [
                                circleBridgeMessage,
                                circleAttester.createAttestation(circleBridgeMessage),
                            ];
                        } else {
                            return [Buffer.alloc(0), Buffer.alloc(0)];
                        }
                    })();

                    const orderResponse: OrderResponse = {
                        encodedWormholeMessage: fillVaa,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("orderResponse", orderResponse);
                });
            }

            it(`Pong Network -- Redeem Fill`, async () => {
                const orderResponse = localVariables.get("orderResponse") as OrderResponse;
                expect(localVariables.delete("orderResponse")).is.true;

                const usdc = IERC20__factory.connect(pongEnv.tokenAddress, pongProvider);
                const balanceBefore = await usdc.balanceOf(pongWallet.address);

                const receipt = await pongOrderRouter
                    .redeemFill(orderResponse)
                    .then((tx) => mineWait(pongProvider, tx));

                const balanceAfter = await usdc.balanceOf(pongWallet.address);

                console.log("balance check", balanceBefore.toString(), balanceAfter.toString());

                // TODO: Check balance.
            });

            it(`Pong Network -- Place Market Order`, async () => {
                const amountIn = await (async () => {
                    if (pongEnv.chainType == ChainType.Evm) {
                        const usdc = IERC20__factory.connect(pongEnv.tokenAddress, pongWallet);
                        const amount = await usdc.balanceOf(pongWallet.address);
                        await usdc
                            .approve(pongOrderRouter.address, amount)
                            .then((tx) => mineWait(pongProvider, tx));

                        return BigInt(amount.toString());
                    } else {
                        throw new Error("Unsupported chain");
                    }
                })();

                const targetChain = coalesceChainId(pingChainName);

                const receipt = await pongOrderRouter
                    .computeMinAmountOut(amountIn, targetChain)
                    .then((minAmountOut) =>
                        pongOrderRouter.placeMarketOrder({
                            amountIn,
                            minAmountOut,
                            targetChain,
                            redeemer: Buffer.from(
                                tryNativeToUint8Array(pingWallet.address, pingChainName)
                            ),
                            redeemerMessage: Buffer.from("All your base are belong to us."),
                            refundAddress: pongWallet.address,
                        })
                    )
                    .then((tx) => mineWait(pongProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const transactionResult = await pongOrderRouter.getTransactionResults(
                    receipt.transactionHash
                );

                const possiblyOrderVaa = await guardianNetwork.observeEvm(
                    pongProvider,
                    pongChainName,
                    receipt
                );

                if (pongChainName == "avalanche") {
                    expect(transactionResult.wormhole.message.body).has.property("fill");

                    const [circleBridgeMessage, circleAttestation] = (() => {
                        if (transactionResult.circleMessage !== undefined) {
                            const circleBridgeMessage = transactionResult.circleMessage;
                            return [
                                circleBridgeMessage,
                                circleAttester.createAttestation(circleBridgeMessage),
                            ];
                        } else {
                            return [Buffer.alloc(0), Buffer.alloc(0)];
                        }
                    })();

                    const orderResponse: OrderResponse = {
                        encodedWormholeMessage: possiblyOrderVaa,
                        circleBridgeMessage,
                        circleAttestation,
                    };

                    localVariables.set("orderResponse", orderResponse);
                } else {
                    expect(transactionResult.wormhole.message.body).has.property("marketOrder");

                    if (transactionResult.circleMessage !== undefined) {
                        const circleBridgeMessage = transactionResult.circleMessage;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        localVariables.set("circleBridgeMessage", circleBridgeMessage);
                        localVariables.set("circleAttestation", circleAttestation);
                    }

                    localVariables.set("orderVaa", possiblyOrderVaa);
                }
            });

            if (pongChainName != "avalanche") {
                it(`Matching Engine -- Relay Order`, async () => {
                    expect(localVariables.has("orderResponse")).is.false;

                    const orderVaa = localVariables.get("orderVaa") as Buffer;
                    expect(localVariables.delete("orderVaa")).is.true;

                    const receipt = await (async () => {
                        if (pongEnv.chainType === ChainType.Evm) {
                            if (localVariables.has("circleBridgeMessage")) {
                                const circleBridgeMessage = localVariables.get(
                                    "circleBridgeMessage"
                                ) as Buffer;
                                localVariables.delete("circleBridgeMessage");

                                const circleAttestation = localVariables.get(
                                    "circleAttestation"
                                ) as Buffer;
                                expect(localVariables.delete("circleAttestation")).is.true;

                                return matchingEngine["executeOrder((bytes,bytes,bytes))"]({
                                    encodedWormholeMessage: orderVaa,
                                    circleBridgeMessage,
                                    circleAttestation,
                                });
                            } else {
                                return matchingEngine["executeOrder(bytes)"](orderVaa);
                            }
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })().then((tx) => mineWait(meProvider, tx));

                    const fillVaa = await guardianNetwork.observeEvm(
                        meProvider,
                        "avalanche",
                        receipt
                    );

                    const wormholeCctp = ICircleIntegration__factory.connect(
                        matchingEngineEnv.wormholeCctpAddress,
                        meProvider
                    );
                    const transactionResult = await Promise.all([
                        wormholeCctp.wormhole(),
                        wormholeCctp.circleTransmitter(),
                    ]).then(([coreBridgeAddress, circleTransmitterAddress]) =>
                        LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
                            "avalanche",
                            coreBridgeAddress,
                            wormholeCctp.address,
                            receipt,
                            circleTransmitterAddress
                        )
                    );
                    expect(transactionResult.wormhole.message.body).has.property("fill");

                    const [circleBridgeMessage, circleAttestation] = (() => {
                        if (transactionResult.circleMessage !== undefined) {
                            const circleBridgeMessage = transactionResult.circleMessage;
                            return [
                                circleBridgeMessage,
                                circleAttester.createAttestation(circleBridgeMessage),
                            ];
                        } else {
                            return [Buffer.alloc(0), Buffer.alloc(0)];
                        }
                    })();

                    const orderResponse: OrderResponse = {
                        encodedWormholeMessage: fillVaa,
                        circleBridgeMessage,
                        circleAttestation,
                    };

                    localVariables.set("orderResponse", orderResponse);
                });
            }

            it(`Ping Network -- Redeem Fill`, async () => {
                const orderResponse = localVariables.get("orderResponse") as OrderResponse;
                expect(localVariables.delete("orderResponse")).is.true;

                const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingProvider);
                const balanceBefore = await usdc.balanceOf(pingWallet.address);

                const receipt = await pingOrderRouter
                    .redeemFill(orderResponse)
                    .then((tx) => mineWait(pingProvider, tx));

                const balanceAfter = await usdc.balanceOf(pingWallet.address);

                console.log("balance change", balanceBefore.toString(), balanceAfter.toString());
                // TODO: Check balance.
            });
        });
    }
});
