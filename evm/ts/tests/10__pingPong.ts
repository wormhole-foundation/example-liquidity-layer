import {
  coalesceChainId,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { expect } from "chai";
import { ethers } from "ethers";
import {
  ChainType,
  EvmOrderRouter,
  Fill,
  Message,
  OrderResponse,
  TokenType,
  errorDecoder,
  parseLiquidityLayerEnvFile,
  parseMarketOrderPlaced,
} from "../src";
import { IERC20__factory, IMatchingEngine__factory } from "../src/types";
import {
  CircleAttester,
  GuardianNetwork,
  LOCALHOSTS,
  ValidNetworks,
  WALLET_PRIVATE_KEYS,
  mineWait,
  mintNativeUsdc,
} from "./helpers";

describe("Ping Pong", () => {
  const envPath = `${__dirname}/../../env/localnet`;

  // Avalanche setup for Matching Engine.
  const avalancheEnv = parseLiquidityLayerEnvFile(`${envPath}/avalanche.env`);
  const matchingEngineAddress = tryUint8ArrayToNative(
    ethers.utils.arrayify(avalancheEnv.matchingEngineEndpoint),
    "avalanche"
  );
  const meProvider = new ethers.providers.StaticJsonRpcProvider(
    LOCALHOSTS.avalanche
  );

  const relayer = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], meProvider);
  const matchingEngine = IMatchingEngine__factory.connect(
    matchingEngineAddress,
    relayer
  );

  const meCircleAttester = new CircleAttester(avalancheEnv.wormholeCctpAddress);

  const guardianNetwork = new GuardianNetwork();

  // const chainNames = ["ethereum", "avalanche", "bsc", "moonbeam"];
  const chainNames: ValidNetworks[] = []; //"avalanche", "bsc"];

  const directRoutes = ["ethereum <> avalanche", "ethereum <> moonbeam"];

  for (let i = 0; i < chainNames.length; ++i) {
    for (let j = i + 1; j < chainNames.length; ++j) {
      const localVariables = new Map<string, any>();

      const pingChainName = chainNames[i];
      const pongChainName = chainNames[j];

      const testName = `${pingChainName} <> ${pongChainName}`;
      const isDirectRoute = directRoutes.includes(testName);

      describe(`${testName}${isDirectRoute ? " (Direct Route)" : ""}`, () => {
        // Ping setup.
        const pingProvider = new ethers.providers.StaticJsonRpcProvider(
          LOCALHOSTS[pingChainName]
        );
        const pingWallet = new ethers.Wallet(
          WALLET_PRIVATE_KEYS[0],
          pingProvider
        );

        const pingEnv = parseLiquidityLayerEnvFile(
          `${envPath}/${pingChainName}.env`
        );
        const pingOrderRouter = (() => {
          if (pingEnv.chainType === ChainType.Evm) {
            return new EvmOrderRouter(pingWallet, pingEnv.orderRouterAddress);
          } else {
            throw new Error("unsupported chain");
          }
        })();

        const pingCircleAttester = new CircleAttester(
          pingEnv.wormholeCctpAddress
        );

        // Pong setup.
        const pongProvider = new ethers.providers.StaticJsonRpcProvider(
          LOCALHOSTS[pongChainName]
        );
        const pongWallet = new ethers.Wallet(
          WALLET_PRIVATE_KEYS[0],
          pongProvider
        );

        const pongEnv = parseLiquidityLayerEnvFile(
          `${envPath}/${pongChainName}.env`
        );
        const pongOrderRouter = (() => {
          if (pongEnv.chainType === ChainType.Evm) {
            return new EvmOrderRouter(pongWallet, pongEnv.orderRouterAddress);
          } else {
            throw new Error("unsupported chain");
          }
        })();

        const pongCircleAttester = new CircleAttester(
          pongEnv.wormholeCctpAddress
        );

        it(`Ping Network -- Mint USDC`, async () => {
          if (pingEnv.chainType == ChainType.Evm) {
            // TODO: fix for bsc
            await mintNativeUsdc(
              IERC20__factory.connect(pingEnv.tokenAddress, pingProvider),
              pingWallet.address,
              "1000000000"
            );
          } else {
            throw new Error("unsupported chain");
          }
        });

        it(`Ping Network -- Place Market Order`, async () => {
          const amountIn = await (async () => {
            if (pingEnv.chainType == ChainType.Evm) {
              const usdc = IERC20__factory.connect(
                pingEnv.tokenAddress,
                pingWallet
              );
              const amount = await usdc.balanceOf(pingWallet.address);
              await usdc
                .approve(pingOrderRouter.address, amount)
                .then((tx) => mineWait(pingProvider, tx));

              return BigInt(amount.toString());
            } else {
              throw new Error("unsupported chain");
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
          const orderVaa = await guardianNetwork.observeEvm(
            pingProvider,
            pingChainName,
            receipt
          );
          localVariables.set("orderVaa", orderVaa);

          const tokenType = await pingOrderRouter.tokenType();
          if (tokenType == TokenType.Cctp && pingChainName != "avalanche") {
            const { circleBridgeMessage, circleAttestation } =
              await pingCircleAttester.observeEvm(
                pingProvider,
                pingChainName,
                receipt
              );
            localVariables.set("circleBridgeMessage", circleBridgeMessage);
            localVariables.set("circleAttestation", circleAttestation);
          }

          const tokenBridgeEmitterAddress = tryNativeToUint8Array(
            pingEnv.tokenBridgeAddress,
            pingChainName
          );
          const wormholeCctpEmitterAddress = tryNativeToUint8Array(
            pingEnv.wormholeCctpAddress,
            pingChainName
          );

          const { decoded } = new Message(
            tokenBridgeEmitterAddress,
            wormholeCctpEmitterAddress
          ).parseVaa(orderVaa);

          if ("fill" in decoded) {
            const fill = decoded.message as Fill;

            const encodedWormholeMessage = localVariables.get(
              "orderVaa"
            ) as Buffer;
            expect(localVariables.delete("orderVaa")).is.true;

            const [circleBridgeMessage, circleAttestation] = (() => {
              try {
                const marketOrderPlaced = parseMarketOrderPlaced(
                  receipt,
                  pingOrderRouter.address
                );
                console.log("marketOrderPlaced", marketOrderPlaced);

                const circleBridgeMessage = localVariables.get(
                  "circleBridgeMessage"
                ) as Buffer;
                expect(localVariables.delete("circleBridgeMessage")).is.true;

                const circleAttestation = localVariables.get(
                  "circleAttestation"
                ) as Buffer;
                expect(localVariables.delete("circleAttestation")).is.true;

                return [circleBridgeMessage, circleAttestation];
              } catch (error) {
                expect(error).to.equal("Error: contract address not found");
                return [Buffer.alloc(0), Buffer.alloc(0)];
              }
            })();

            const orderResponse: OrderResponse = {
              encodedWormholeMessage,
              circleBridgeMessage,
              circleAttestation,
            };
            localVariables.set("orderResponse", orderResponse);
          }
        });

        if (pingChainName != "avalanche" && !isDirectRoute) {
          it(`Matching Engine -- Relay Order`, async () => {
            expect(localVariables.has("orderResponse")).is.false;

            const orderVaa = localVariables.get("orderVaa") as Buffer;
            expect(localVariables.delete("orderVaa")).is.true;

            const receipt = await (async () => {
              if (pingEnv.chainType === ChainType.Evm) {
                if (
                  pingEnv.wormholeCctpAddress != ethers.constants.AddressZero
                ) {
                  const circleBridgeMessage = localVariables.get(
                    "circleBridgeMessage"
                  ) as Buffer;
                  expect(localVariables.delete("circleBridgeMessage")).is.true;

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
                throw new Error("unsupported chain");
              }
            })().then((tx) => mineWait(meProvider, tx));

            const signedVaa = await guardianNetwork.observeEvm(
              meProvider,
              "avalanche",
              receipt
            );

            const { circleBridgeMessage, circleAttestation } =
              await (async () => {
                const tokenType = await pongOrderRouter.tokenType();
                if (tokenType == TokenType.Cctp) {
                  return meCircleAttester.observeEvm(
                    meProvider,
                    "avalanche",
                    receipt
                  );
                } else {
                  return {
                    circleBridgeMessage: Buffer.alloc(0),
                    circleAttestation: Buffer.alloc(0),
                  };
                }
              })();

            const orderResponse: OrderResponse = {
              encodedWormholeMessage: signedVaa,
              circleBridgeMessage,
              circleAttestation,
            };
            localVariables.set("orderResponse", orderResponse);
          });
        }

        it(`Pong Network -- Redeem Fill`, async () => {
          const orderResponse = localVariables.get(
            "orderResponse"
          ) as OrderResponse;
          expect(localVariables.delete("orderResponse")).is.true;

          const usdc = IERC20__factory.connect(
            pongEnv.tokenAddress,
            pongProvider
          );
          const balanceBefore = await usdc.balanceOf(pongWallet.address);

          const receipt = await pongOrderRouter
            .redeemFill(orderResponse)
            .then((tx) => mineWait(pongProvider, tx));

          const balanceAfter = await usdc.balanceOf(pongWallet.address);

          console.log(
            "balance check",
            balanceBefore.toString(),
            balanceAfter.toString()
          );

          // TODO: Check balance.
        });

        it(`Pong Network -- Place Market Order`, async () => {
          const amountIn = await (async () => {
            if (pongEnv.chainType == ChainType.Evm) {
              const usdc = IERC20__factory.connect(
                pongEnv.tokenAddress,
                pongWallet
              );
              const amount = await usdc.balanceOf(pongWallet.address);
              await usdc
                .approve(pongOrderRouter.address, amount)
                .then((tx) => mineWait(pongProvider, tx));

              return BigInt(amount.toString());
            } else {
              throw new Error("unsupported chain");
            }
          })();

          console.log("amountIn", amountIn.toString());

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
          const orderVaa = await guardianNetwork.observeEvm(
            pongProvider,
            pongChainName,
            receipt
          );
          localVariables.set("orderVaa", orderVaa);

          const tokenType = await pongOrderRouter.tokenType();
          if (tokenType == TokenType.Cctp) {
            const { circleBridgeMessage, circleAttestation } =
              await pongCircleAttester.observeEvm(
                pongProvider,
                pongChainName,
                receipt
              );
            localVariables.set("circleBridgeMessage", circleBridgeMessage);
            localVariables.set("circleAttestation", circleAttestation);
          }

          const tokenBridgeEmitterAddress = tryNativeToUint8Array(
            pongEnv.tokenBridgeAddress,
            pongChainName
          );
          const wormholeCctpEmitterAddress = tryNativeToUint8Array(
            pongEnv.wormholeCctpAddress,
            pongChainName
          );

          const { decoded } = new Message(
            tokenBridgeEmitterAddress,
            wormholeCctpEmitterAddress
          ).parseVaa(orderVaa);

          if ("fill" in decoded) {
            const fill = decoded.message as Fill;

            const encodedWormholeMessage = localVariables.get(
              "orderVaa"
            ) as Buffer;
            expect(localVariables.delete("orderVaa")).is.true;

            const circleBridgeMessage = localVariables.get(
              "circleBridgeMessage"
            ) as Buffer;
            expect(localVariables.delete("circleBridgeMessage")).is.true;

            const circleAttestation = localVariables.get(
              "circleAttestation"
            ) as Buffer;
            expect(localVariables.delete("circleAttestation")).is.true;

            const orderResponse: OrderResponse = {
              encodedWormholeMessage,
              circleBridgeMessage,
              circleAttestation,
            };
            localVariables.set("orderResponse", orderResponse);
          }
        });

        if (pongChainName != "avalanche" && !isDirectRoute) {
          it(`Matching Engine -- Relay Order`, async () => {
            expect(localVariables.has("orderResponse")).is.false;

            const orderVaa = localVariables.get("orderVaa") as Buffer;
            expect(localVariables.delete("orderVaa")).is.true;

            const receipt = await (async () => {
              if (pongEnv.chainType === ChainType.Evm) {
                if (
                  pongEnv.wormholeCctpAddress != ethers.constants.AddressZero
                ) {
                  const circleBridgeMessage = localVariables.get(
                    "circleBridgeMessage"
                  ) as Buffer;
                  expect(localVariables.delete("circleBridgeMessage")).is.true;

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
                throw new Error("unsupported chain");
              }
            })().then((tx) => mineWait(meProvider, tx));

            const signedVaa = await guardianNetwork.observeEvm(
              meProvider,
              "avalanche",
              receipt
            );

            const { circleBridgeMessage, circleAttestation } =
              await (async () => {
                const tokenType = await pingOrderRouter.tokenType();
                if (tokenType == TokenType.Cctp) {
                  return meCircleAttester.observeEvm(
                    meProvider,
                    "avalanche",
                    receipt
                  );
                } else {
                  return {
                    circleBridgeMessage: Buffer.alloc(0),
                    circleAttestation: Buffer.alloc(0),
                  };
                }
              })();

            const orderResponse: OrderResponse = {
              encodedWormholeMessage: signedVaa,
              circleBridgeMessage,
              circleAttestation,
            };
            localVariables.set("orderResponse", orderResponse);
          });
        }

        it(`Ping Network -- Redeem Fill`, async () => {
          const orderResponse = localVariables.get(
            "orderResponse"
          ) as OrderResponse;
          expect(localVariables.delete("orderResponse")).is.true;

          const usdc = IERC20__factory.connect(
            pingEnv.tokenAddress,
            pingProvider
          );
          const balanceBefore = await usdc.balanceOf(pingWallet.address);

          const receipt = await pingOrderRouter
            .redeemFill(orderResponse)
            .then((tx) => mineWait(pingProvider, tx));

          const balanceAfter = await usdc.balanceOf(pingWallet.address);

          console.log(
            "balance change",
            balanceBefore.toString(),
            balanceAfter.toString()
          );
          // TODO: Check balance.
        });

        it(`Burn USDC`, async () => {
          const usdc = IERC20__factory.connect(
            pingEnv.tokenAddress,
            pingWallet
          );

          await usdc
            .balanceOf(pingWallet.address)
            .then((balance) =>
              usdc.transfer(
                "0x0000000000000000000000000000000000000001",
                balance
              )
            )
            .then((tx) => mineWait(pingProvider, tx));
        });
      });
    }
  }
});
