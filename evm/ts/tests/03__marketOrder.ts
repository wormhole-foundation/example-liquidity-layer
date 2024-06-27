import { encoding, toChainId } from "@wormhole-foundation/sdk-base";
import { signAndSendWait } from "@wormhole-foundation/sdk-connect";
import { expect } from "chai";
import { ethers } from "ethers";
import { EvmTokenRouter, OrderResponse, errorDecoder } from "../src";
import {
    CircleAttester,
    GuardianNetwork,
    LOCALHOSTS,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    burnAllUsdc,
    getSdkSigner,
    mineWait,
    mintNativeUsdc,
    parseLiquidityLayerEnvFile,
    signSendMineWait,
    toContractAddresses,
    tryNativeToUint8Array,
} from "../src/testing";
import { IERC20__factory } from "../src/types";
import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { CircleBridge, deserialize, toNative } from "@wormhole-foundation/sdk-definitions";
import { EvmNativeSigner } from "@wormhole-foundation/sdk-evm/dist/cjs";

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
            const fromSigner = getSdkSigner(fromChainName, fromWallet);

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
                    if (fromEnv.chainType == "Evm") {
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

                const minAmountOut = BigInt(0);
                const redeemer = toNative("Ethereum", toWallet.address).toUniversalAddress();
                const order: TokenRouter.OrderRequest = {
                    amountIn,
                    minAmountOut,
                    redeemer,
                    targetChain: toChainName,
                };

                const txs = fromTokenRouter.placeMarketOrder(fromWallet.address, order);
                const receipt = await signSendMineWait(txs, fromSigner);
                const transactionResult = await fromTokenRouter.getTransactionResults(
                    receipt!.hash,
                );

                expect(transactionResult.wormhole.emitterAddress).to.eql(
                    tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName),
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

                const vaa = deserialize(
                    "FastTransfer:CctpDeposit",
                    orderResponse.encodedWormholeMessage,
                );
                const [msg] = CircleBridge.deserialize(orderResponse.circleBridgeMessage);
                const cctpMsg: CircleBridge.Attestation = {
                    message: msg,
                    attestation: encoding.hex.encode(orderResponse.circleAttestation),
                };
                const txs = toTokenRouter.redeemFill(toWallet.address, vaa, cctpMsg);
                const receipt = await signSendMineWait(txs, toSigner);

                const balanceAfter = await usdc.balanceOf(toWallet.address);

                expect((balanceAfter - balanceBefore).toString()).to.eql(
                    localVariables.get("amountIn").toString(),
                );
                expect(localVariables.delete("amountIn")).is.true;
            });
        });
    }
});
