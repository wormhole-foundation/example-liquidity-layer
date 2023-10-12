import {
  coalesceChainId,
  tryHexToNativeString,
  tryNativeToHexString,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { TokenImplementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { expect } from "chai";
import { ethers } from "ethers";
import * as fs from "fs";
import {
  CurveFactory__factory,
  ICircleBridge__factory,
  ICircleIntegration__factory,
  ICurvePool__factory,
  IMatchingEngine__factory,
  IMessageTransmitter__factory,
  IOrderRouter__factory,
  ITokenBridge__factory,
  IUSDC__factory,
  IWormhole__factory,
} from "../src/types";
import {
  CURVE_FACTORY_ADDRESS,
  GUARDIAN_PRIVATE_KEY,
  LOCALHOSTS,
  MATCHING_ENGINE_POOL_COINS,
  POLYGON_USDC_ADDRESS,
  TOKEN_TYPES,
  USDC_ADDRESSES,
  USDC_DECIMALS,
  WALLET_PRIVATE_KEYS,
  WORMHOLE_GUARDIAN_SET_INDEX,
  WORMHOLE_MESSAGE_FEE,
  mineWait,
  mintNativeUsdc,
  mintWrappedTokens,
  OWNER_PRIVATE_KEY,
  OWNER_ASSISTANT_PRIVATE_KEY,
} from "./helpers";
import { execSync } from "child_process";

import { parse as envParse } from "envfile";
import { parseLiquidityLayerEnvFile } from "./helpers";
import { ETHEREUM_KEY_LENGTH } from "@certusone/wormhole-sdk/lib/cjs/solana";

describe("Ping Pong", () => {
  const envPath = `${__dirname}/../../env/localnet`;

  // Avalanche setup for Matching Engine.
  const avalancheEnv = parseLiquidityLayerEnvFile(`${envPath}/avalanche.env`);
  const matchingEngineAddress = tryUint8ArrayToNative(
    ethers.utils.arrayify(avalancheEnv.matchingEngineEndpoint),
    "avalanche"
  );
  const meProvider = new ethers.providers.JsonRpcProvider(LOCALHOSTS.avalanche);

  const relayer = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], meProvider);
  const matchingEngine = IMatchingEngine__factory.connect(
    matchingEngineAddress,
    relayer
  );

  const chainNames = ["ethereum", "bsc", "avalanche", "moonbeam"];

  for (let i = 0; i < chainNames.length; ++i) {
    for (let j = i + 1; j < chainNames.length; ++j) {
      const pingChainName = chainNames[i];
      const pongChainName = chainNames[j];

      // hack for now
      if (pingChainName != "ethereum" || pongChainName != "bsc") {
        continue;
      }

      describe(`${pingChainName} <> ${pongChainName}`, () => {
        console.log(pingChainName, pongChainName);

        // Ping setup.
        const pingProvider = new ethers.providers.JsonRpcProvider(
          LOCALHOSTS[pingChainName]
        );
        const pingWallet = new ethers.Wallet(
          WALLET_PRIVATE_KEYS[0],
          pingProvider
        );

        const pingEnv = parseLiquidityLayerEnvFile(
          `${envPath}/${pingChainName}.env`
        );
        const pingOrderRouter = IOrderRouter__factory.connect(
          pingEnv.orderRouterAddress,
          pingWallet
        );

        // Pong setup.
        const pongProvider = new ethers.providers.JsonRpcProvider(
          LOCALHOSTS[pongChainName]
        );
        const pongWallet = new ethers.Wallet(
          WALLET_PRIVATE_KEYS[0],
          pongProvider
        );

        const pongEnv = parseLiquidityLayerEnvFile(
          `${envPath}/${pongChainName}.env`
        );
        const pongOrderRouter = IOrderRouter__factory.connect(
          pongEnv.orderRouterAddress,
          pongWallet
        );

        it(`Network: ${pingChainName} -- Mint USDC`, async () => {
          // TODO
        });

        it(`Network: ${pingChainName} -- Place Market Order`, async () => {
          // TODO
        });

        it(`Matching Engine -- Relay Order`, async () => {
          // TODO
        });

        it(`Network: ${pongChainName} -- Redeem Fill`, async () => {
          // TODO
        });

        it(`Network: ${pongChainName} -- Place Market Order`, async () => {
          // TODO
        });

        it(`Matching Engine -- Relay Order`, async () => {
          // TODO
        });

        it(`Network: ${pingChainName} -- Redeem Fill`, async () => {
          // TODO
        });
      });
    }
  }

  // Ping network setup (where the first transfer starts and the second transfer ends).

  // Pong network setup (where the first transfer ends and second transfer starts).
  // const pingProvider = new ethers.providers.JsonRpcProvider(
  //   LOCALHOSTS.ethereum
  // );
  // const pingOrderRouter = IOrderRouter__factory.connect(
  //   ORDER_ROUTERS.ethereum,
  //   pingProvider
  // );

  // const pongProvider = new ethers.providers.JsonRpcProvider(LOCALHOSTS.bsc);
  // const pongOrderRouter = IOrderRouter__factory.connect(
  //   ORDER_ROUTERS.bsc,
  //   pongProvider
  // );

  // it("Ethereum to BSC", async () => {
  //   console.log(avalancheEnv);
  // });
});
