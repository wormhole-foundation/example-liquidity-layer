import {
  coalesceChainId,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { IMatchingEngine__factory } from "../src/types";
import {
  LOCALHOSTS,
  OWNER_ASSISTANT_PRIVATE_KEY,
  TOKEN_TYPES,
  ValidNetworks,
  WALLET_PRIVATE_KEYS,
  mineWait,
} from "./helpers";

import { OrderRouter } from "../src";
import { parseLiquidityLayerEnvFile } from "./helpers";

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
