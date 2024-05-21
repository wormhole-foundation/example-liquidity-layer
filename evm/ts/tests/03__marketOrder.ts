import { expect } from "chai";
import { ethers } from "ethers";
import { EvmTokenRouter, errorDecoder, OrderResponse } from "../src";
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
    ChainType,
    parseLiquidityLayerEnvFile,
    tryNativeToUint8Array,
} from "./helpers";
import { serialize, toChainId } from "@wormhole-foundation/sdk";

const CHAIN_PATHWAYS: ValidNetwork[][] = [
    ["Ethereum", "Avalanche"],
    ["Avalanche", "Ethereum"],
    ["Ethereum", "Base"],
    ["Base", "Ethereum"],
    ["Avalanche", "Base"],
    ["Base", "Avalanche"],
];

const TEST_AMOUNT = ethers.utils.parseUnits("1000", 6);

describe("Market Order Business Logic -- CCTP to CCTP", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    const guardianNetwork = new GuardianNetwork();
    const circleAttester = new CircleAttester();

    for (const [fromChainName, toChainName] of CHAIN_PATHWAYS) {
        const localVariables = new Map<string, any>();

        describe(`${fromChainName} <> ${toChainName}`, () => {
            // From setup.
            const fromProvider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[fromChainName],
            );
            const fromWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[0], fromProvider);

            const fromEnv = parseLiquidityLayerEnvFile(`${envPath}/${fromChainName}.env`);
            const fromTokenRouter = (() => {
                if (fromEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(
                        fromWallet,
                        fromEnv.tokenRouterAddress,
                        fromEnv.tokenMessengerAddress,
                    );
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            // To setup.
            const toProvider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS[toChainName]);
            const toWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], toProvider);

            const toEnv = parseLiquidityLayerEnvFile(`${envPath}/${toChainName}.env`);
            const toTokenRouter = (() => {
                if (toEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(
                        toWallet,
                        toEnv.tokenRouterAddress,
                        toEnv.tokenMessengerAddress,
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
                    if (fromEnv.chainType == ChainType.Evm) {
                        const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                        const amount = await usdc.balanceOf(fromWallet.address);
                        await usdc
                            .approve(fromTokenRouter.address, amount)
                            .then((tx) => mineWait(fromProvider, tx));

                        return BigInt(amount.toString());
                    } else {
                        throw new Error("Unsupported chain");
                    }
                })();
                localVariables.set("amountIn", amountIn);

                const targetChain = toChainId(toChainName);
                const minAmountOut = BigInt(0);
                const receipt = await fromTokenRouter
                    .placeMarketOrder(
                        amountIn,
                        targetChain,
                        Buffer.from(tryNativeToUint8Array(toWallet.address, toChainName)),
                        Buffer.from("All your base are belong to us."),
                        minAmountOut,
                        fromWallet.address,
                    )
                    .then((tx) => mineWait(fromProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });
                const transactionResult = await fromTokenRouter.getTransactionResults(
                    receipt.transactionHash,
                );

                expect(transactionResult.wormhole.emitterAddress).to.eql(
                    tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName),
                );
                expect(transactionResult.wormhole.message.body).has.property("fill");
                expect(transactionResult.circleMessage).is.not.undefined;

                const fillVaa = await guardianNetwork.observeEvm(
                    fromProvider,
                    fromChainName,
                    receipt,
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

                const receipt = await toTokenRouter
                    .redeemFill(orderResponse)
                    .then((tx) => mineWait(toProvider, tx))
                    .catch((err) => {
                        console.log(err);
                        console.log(errorDecoder(err));
                        throw err;
                    });

                const balanceAfter = await usdc.balanceOf(toWallet.address);

                expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                    localVariables.get("amountIn").toString(),
                );
                expect(localVariables.delete("amountIn")).is.true;
            });
        });
    }
});
