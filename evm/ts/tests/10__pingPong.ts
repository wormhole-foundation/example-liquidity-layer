import {
  coalesceChainId,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { IERC20__factory, IMatchingEngine__factory } from "../src/types";
import {
  CircleAttester,
  GuardianNetwork,
  LOCALHOSTS,
  USDC_ADDRESSES,
  ValidNetworks,
  WALLET_PRIVATE_KEYS,
  mineWait,
  mintNativeUsdc,
} from "./helpers";

import { expect } from "chai";
import {
  ChainType,
  EvmOrderRouter,
  MarketOrder,
  Message,
  OrderResponse,
  TokenType,
  parseLiquidityLayerEnvFile,
} from "../src";

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

  // const chainNames = ["ethereum", "bsc", "avalanche", "moonbeam"];
  const chainNames: ValidNetworks[] = ["ethereum", "bsc"];

  for (let i = 0; i < chainNames.length; ++i) {
    for (let j = i + 1; j < chainNames.length; ++j) {
      const localVariables = new Map<string, any>();

      const pingChainName = chainNames[i];
      const pongChainName = chainNames[j];

      describe(`${pingChainName} <> ${pongChainName}`, () => {
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

          const receipt = await pingOrderRouter
            .placeMarketOrder({
              amountIn,
              minAmountOut: BigInt("1"),
              targetChain: coalesceChainId(pongChainName),
              redeemer: Buffer.from(
                tryNativeToUint8Array(pongWallet.address, pongChainName)
              ),
              redeemerMessage: Buffer.from("All your base are belong to us."),
              refundAddress: pingWallet.address,
            })
            .then((tx) => mineWait(pingProvider, tx));
          // .catch((err) => {
          //   console.log(err);
          //   console.log(errorDecoder(err));
          //   throw err;
          // });
          const orderVaa = await guardianNetwork.observeEvm(
            pingProvider,
            pingChainName,
            receipt
          );
          localVariables.set("orderVaa", orderVaa);

          const tokenType = await pingOrderRouter.tokenType();
          if (tokenType == TokenType.Cctp) {
            const { circleBridgeMessage, circleAttestation } =
              await pingCircleAttester.observeEvm(
                pingProvider,
                pingChainName,
                receipt
              );
            localVariables.set("circleBridgeMessage", circleBridgeMessage);
            localVariables.set("circleAttestation", circleAttestation);
          }
        });

        it(`Matching Engine -- Relay Order`, async () => {
          const orderVaa = localVariables.get("orderVaa") as Buffer;
          expect(localVariables.delete("orderVaa")).is.true;

          const pingTokenBridgeEmitterAddress = tryNativeToUint8Array(
            pingEnv.tokenBridgeAddress,
            pingChainName
          );
          const pingWormholeCctpEmitterAddress = tryNativeToUint8Array(
            pingEnv.wormholeCctpAddress,
            pingChainName
          );

          const { vaa, decoded } = new Message(
            pingTokenBridgeEmitterAddress,
            pingWormholeCctpEmitterAddress
          ).parseVaa(orderVaa);
          expect(decoded).has.property("marketOrder");

          const marketOrder = decoded.message as MarketOrder;

          const receipt = await (async () => {
            if (pingEnv.chainType === ChainType.Evm) {
              if (pingEnv.wormholeCctpAddress != ethers.constants.AddressZero) {
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

        it(`Pong Network -- Redeem Fill`, async () => {
          const orderResponse = localVariables.get(
            "orderResponse"
          ) as OrderResponse;
          expect(localVariables.delete("orderResponse")).is.true;

          const usdc = IERC20__factory.connect(
            USDC_ADDRESSES[pongChainName],
            pongProvider
          );
          const balanceBefore = await usdc.balanceOf(pongWallet.address);

          const receipt = await pongOrderRouter
            .redeemFill(orderResponse)
            .then((tx) => mineWait(pongProvider, tx));

          const balanceAfter = await usdc.balanceOf(pongWallet.address);

          // TODO: Check balance.
        });

        it.skip(`Pong Network -- Place Market Order`, async () => {
          const amountIn = await (async () => {
            if (pongEnv.chainType == ChainType.Evm) {
              const usdc = IERC20__factory.connect(
                pongEnv.tokenAddress,
                pongWallet
              );
              const amount = await usdc.balanceOf(pongWallet.address);
              usdc
                .approve(pongOrderRouter.address, amount)
                .then((tx) => mineWait(pongProvider, tx));

              return BigInt(amount.toString());
            } else {
              throw new Error("unsupported chain");
            }
          })();

          const receipt = await pongOrderRouter
            .placeMarketOrder({
              amountIn,
              minAmountOut: BigInt("1"),
              targetChain: coalesceChainId(pingChainName),
              redeemer: Buffer.from(
                tryNativeToUint8Array(pingWallet.address, pingChainName)
              ),
              redeemerMessage: Buffer.from("All your base are belong to us."),
              refundAddress: pingWallet.address,
            })
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
              await pingCircleAttester.observeEvm(
                pingProvider,
                pingChainName,
                receipt
              );
            localVariables.set("circleBridgeMessage", circleBridgeMessage);
            localVariables.set("circleAttestation", circleAttestation);
          }
        });

        it.skip(`Matching Engine -- Relay Order`, async () => {
          // TODO
        });

        it.skip(`Ping Network -- Redeem Fill`, async () => {
          // TODO
        });
      });
    }
  }
});

type DecodedErr = {
  selector: string;
  data?: string;
};

function errorDecoder(ethersError: any): DecodedErr {
  if (
    !("code" in ethersError) ||
    !("error" in ethersError) ||
    !("error" in ethersError.error) ||
    !("error" in ethersError.error.error) ||
    !("code" in ethersError.error.error.error) ||
    !("data" in ethersError.error.error.error)
  ) {
    throw new Error("not contract error");
  }

  const { data } = ethersError.error.error.error as {
    data: string;
  };

  if (data.length < 10 || data.substring(0, 2) != "0x") {
    throw new Error("data not custom error");
  }

  const selector = data.substring(0, 10);

  switch (selector) {
    case computeSelector("ErrZeroMinAmountOut()"): {
      return { selector: "ErrZeroMinAmountOut" };
    }
    case computeSelector("ErrUnsupportedChain(uint16)"): {
      return {
        selector: "ErrUnsupportedChain",
        data: "0x" + data.substring(10),
      };
    }
    default: {
      throw new Error(`unknown selector: ${selector}`);
    }
  }
}

function computeSelector(methodSignature: string): string {
  return ethers.utils.keccak256(Buffer.from(methodSignature)).substring(0, 10);
}
