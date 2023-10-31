import { coalesceChainId, tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { expect } from "chai";
import { ethers } from "ethers";
import {
    ChainType,
    EvmTokenRouter,
    errorDecoder,
    parseLiquidityLayerEnvFile,
    OrderResponse,
} from "../src";
import { IERC20__factory } from "../src/types";
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

const CHAIN_PATHWAYS: ValidNetwork[][] = [["ethereum", "avalanche"]];

const PING_PONG_AMOUNT = ethers.utils.parseUnits("1000", 6);

describe("Ping Pong -- CCTP to CCTP", () => {
    const envPath = `${__dirname}/../../env/localnet`;

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
            const pingtokenRouter = (() => {
                if (pingEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(pingWallet, pingEnv.tokenRouterAddress);
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            // Pong setup.
            const pongProvider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[pongChainName]
            );
            const pongWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], pongProvider);

            const pongEnv = parseLiquidityLayerEnvFile(`${envPath}/${pongChainName}.env`);
            const pongtokenRouter = (() => {
                if (pongEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(pongWallet, pongEnv.tokenRouterAddress);
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

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

            it(`Ping Network -- Place Market Order`, async () => {
                const amountIn = await (async () => {
                    if (pingEnv.chainType == ChainType.Evm) {
                        const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingWallet);
                        const amount = await usdc.balanceOf(pingWallet.address);
                        await usdc
                            .approve(pingtokenRouter.address, amount)
                            .then((tx) => mineWait(pingProvider, tx));

                        return BigInt(amount.toString());
                    } else {
                        throw new Error("Unsupported chain");
                    }
                })();
                localVariables.set("amountIn", amountIn);

                const targetChain = coalesceChainId(pongChainName);
                const minAmountOut = BigInt(0);
                const receipt = await pingtokenRouter
                    .placeMarketOrder({
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer: Buffer.from(
                            tryNativeToUint8Array(pongWallet.address, pongChainName)
                        ),
                        redeemerMessage: Buffer.from("All your base are belong to us."),
                        refundAddress: pingWallet.address,
                    })
                    .then((tx) => mineWait(pingProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });
                const transactionResult = await pingtokenRouter.getTransactionResults(
                    receipt.transactionHash
                );
                expect(transactionResult.wormhole.emitterAddress).to.eql(
                    tryNativeToUint8Array(pingEnv.wormholeCctpAddress, pingChainName)
                );
                expect(transactionResult.wormhole.message.body).has.property("fill");
                expect(transactionResult.circleMessage).is.not.undefined;

                const fillVaa = await guardianNetwork.observeEvm(
                    pingProvider,
                    pingChainName,
                    receipt
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

            it(`Pong Network -- Redeem Fill`, async () => {
                const orderResponse = localVariables.get("orderResponse") as OrderResponse;
                expect(localVariables.delete("orderResponse")).is.true;

                const usdc = IERC20__factory.connect(pongEnv.tokenAddress, pongProvider);
                const balanceBefore = await usdc.balanceOf(pongWallet.address);

                const receipt = await pongtokenRouter
                    .redeemFill(orderResponse)
                    .then((tx) => mineWait(pongProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const balanceAfter = await usdc.balanceOf(pongWallet.address);

                expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                    localVariables.get("amountIn").toString()
                );
                expect(localVariables.delete("amountIn")).is.true;
            });

            it(`Pong Network -- Place Market Order`, async () => {
                const amountIn = await (async () => {
                    if (pongEnv.chainType == ChainType.Evm) {
                        const usdc = IERC20__factory.connect(pongEnv.tokenAddress, pongWallet);
                        const amount = await usdc.balanceOf(pongWallet.address);
                        await usdc
                            .approve(pongtokenRouter.address, amount)
                            .then((tx) => mineWait(pongProvider, tx));

                        return BigInt(amount.toString());
                    } else {
                        throw new Error("Unsupported chain");
                    }
                })();
                localVariables.set("amountIn", amountIn);

                const targetChain = coalesceChainId(pingChainName);
                const minAmountOut = BigInt(0);
                const receipt = await pongtokenRouter
                    .placeMarketOrder({
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer: Buffer.from(
                            tryNativeToUint8Array(pingWallet.address, pingChainName)
                        ),
                        redeemerMessage: Buffer.from("All your base are belong to us."),
                        refundAddress: pongWallet.address,
                    })
                    .then((tx) => mineWait(pongProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const transactionResult = await pongtokenRouter.getTransactionResults(
                    receipt.transactionHash
                );
                expect(transactionResult.wormhole.emitterAddress).to.eql(
                    tryNativeToUint8Array(pongEnv.wormholeCctpAddress, pongChainName)
                );
                expect(transactionResult.wormhole.message.body).has.property("fill");
                expect(transactionResult.circleMessage).is.not.undefined;

                const fillVaa = await guardianNetwork.observeEvm(
                    pongProvider,
                    pongChainName,
                    receipt
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

            it(`Ping Network -- Redeem Fill`, async () => {
                const orderResponse = localVariables.get("orderResponse") as OrderResponse;
                expect(localVariables.delete("orderResponse")).is.true;

                const usdc = IERC20__factory.connect(pingEnv.tokenAddress, pingProvider);
                const balanceBefore = await usdc.balanceOf(pingWallet.address);

                const receipt = await pingtokenRouter
                    .redeemFill(orderResponse)
                    .then((tx) => mineWait(pingProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const balanceAfter = await usdc.balanceOf(pingWallet.address);

                expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                    localVariables.get("amountIn").toString()
                );
                expect(localVariables.delete("amountIn")).is.true;
            });
        });
    }
});
