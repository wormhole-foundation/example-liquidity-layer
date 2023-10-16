import {
  coalesceChainId,
  tryHexToNativeString,
  tryNativeToHexString,
  tryNativeToUint8Array,
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
  USDC_DECIMALS,
  WALLET_PRIVATE_KEYS,
  WORMHOLE_GUARDIAN_SET_INDEX,
  WORMHOLE_MESSAGE_FEE,
  mineWait,
  mintNativeUsdc,
  mintWrappedTokens,
  OWNER_PRIVATE_KEY,
  OWNER_ASSISTANT_PRIVATE_KEY,
  ValidNetworks,
  USDC_ADDRESSES,
} from "./helpers";
import { execSync } from "child_process";

import { parse as envParse } from "envfile";
import { parseLiquidityLayerEnvFile } from "./helpers";
import { ETHEREUM_KEY_LENGTH } from "@certusone/wormhole-sdk/lib/cjs/solana";
import { OrderRouter } from "../src";

describe("Registration", () => {
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

  const chainNames: ValidNetworks[] = [
    "avalanche",
    "ethereum",
    "bsc",
    "moonbeam",
  ];

  for (const chainName of chainNames) {
    it.skip(`Matching Engine -- Register ${chainName}`, async () => {
      // TODO
    });
  }

  for (const chainName of chainNames) {
    const provider = new ethers.providers.JsonRpcProvider(
      LOCALHOSTS[chainName]
    );
    const ownerAssistant = new ethers.Wallet(
      OWNER_ASSISTANT_PRIVATE_KEY,
      provider
    );

    const chainEnv = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);
    const orderRouter = new OrderRouter(chainEnv.orderRouterAddress);

    for (const targetChainName of chainNames) {
      const targetEnv = parseLiquidityLayerEnvFile(
        `${envPath}/${targetChainName}.env`
      );

      if (chainName == targetChainName) {
        it.skip(`Network: ${chainName} -- Cannot Register Itself`, async () => {
          // TODO
        });
      } else {
        it(`Network: ${chainName} -- Register ${targetChainName}`, async () => {
          await orderRouter
            .addRouterInfo(ownerAssistant, coalesceChainId(targetChainName), {
              endpoint: tryNativeToUint8Array(
                targetEnv.orderRouterAddress,
                targetChainName
              ),
              tokenType: TOKEN_TYPES[targetChainName],
              slippage: 1000, // 0.1%
            })
            .then((tx) => mineWait(provider, tx));

          // TODO: check registration
        });
      }
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
