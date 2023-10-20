import {
  coalesceChainId,
  tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { expect } from "chai";
import { ethers } from "ethers";
import {
  ChainType,
  EvmOrderRouter,
  Message,
  OrderResponse,
  errorDecoder,
  parseLiquidityLayerEnvFile,
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

  for (const [pingChainName, pongChainName] of CHAIN_PATHWAYS) {
    const localVariables = new Map<string, any>();

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
          throw new Error("Unsupported chain");
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
        WALLET_PRIVATE_KEYS[1],
        pongProvider
      );

      const pongEnv = parseLiquidityLayerEnvFile(
        `${envPath}/${pongChainName}.env`
      );
      const pongOrderRouter = (() => {
        if (pongEnv.chainType === ChainType.Evm) {
          return new EvmOrderRouter(pongWallet, pongEnv.orderRouterAddress);
        } else {
          throw new Error("Unsupported chain");
        }
      })();

      const pongCircleAttester = new CircleAttester(
        pongEnv.wormholeCctpAddress
      );

      if (pingEnv.chainType == ChainType.Evm) {
        before(`Ping Network -- Mint USDC`, async () => {
          const usdc = IERC20__factory.connect(
            pingEnv.tokenAddress,
            pingWallet
          );

          await burnAllUsdc(usdc);

          await mintNativeUsdc(
            IERC20__factory.connect(pingEnv.tokenAddress, pingProvider),
            pingWallet.address,
            PING_PONG_AMOUNT
          );
        });

        after(`Burn USDC`, async () => {
          const usdc = IERC20__factory.connect(
            pingEnv.tokenAddress,
            pingWallet
          );
          await burnAllUsdc(usdc);
        });
      } else {
        throw new Error("Test misconfigured");
      }

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

        const fillVaa = await guardianNetwork.observeEvm(
          pingProvider,
          pingChainName,
          receipt
        );

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
        ).parseVaa(fillVaa);
        expect(decoded).has.property("fill");

        const { circleBridgeMessage, circleAttestation } =
          await pingCircleAttester.observeEvm(
            pingProvider,
            pingChainName,
            receipt
          );

        const orderResponse: OrderResponse = {
          encodedWormholeMessage: fillVaa,
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
          pongEnv.tokenAddress,
          pongProvider
        );
        const balanceBefore = await usdc.balanceOf(pongWallet.address);

        const receipt = await pongOrderRouter
          .redeemFill(orderResponse)
          .then((tx) => mineWait(pongProvider, tx))
          .catch((err) => {
            console.log(err);
            console.log(errorDecoder(err));
            throw err;
          });

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
        const fillVaa = await guardianNetwork.observeEvm(
          pongProvider,
          pongChainName,
          receipt
        );

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
        ).parseVaa(fillVaa);
        expect(fillVaa).has.property("fill");

        const { circleBridgeMessage, circleAttestation } =
          await pongCircleAttester.observeEvm(
            pongProvider,
            pongChainName,
            receipt
          );

        const orderResponse: OrderResponse = {
          encodedWormholeMessage: fillVaa,
          circleBridgeMessage,
          circleAttestation,
        };
        localVariables.set("orderResponse", orderResponse);
      });

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
          .then((tx) => mineWait(pingProvider, tx))
          .catch((err) => {
            console.log(err);
            console.log(errorDecoder(err));
            throw err;
          });

        const balanceAfter = await usdc.balanceOf(pingWallet.address);

        console.log(
          "balance change",
          balanceBefore.toString(),
          balanceAfter.toString()
        );
        // TODO: Check balance.
      });
    });
  }
});
