import {
  coalesceChainId,
  tryNativeToUint8Array,
  tryUint8ArrayToNative,
} from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { IERC20, IMatchingEngine__factory } from "../src/types";
import {
  GuardianNetwork,
  LOCALHOSTS,
  USDC_ADDRESSES,
  ValidNetworks,
  WALLET_PRIVATE_KEYS,
  mineWait,
  mintNativeUsdc,
} from "./helpers";

import { OrderRouter } from "../src";
import { parseLiquidityLayerEnvFile } from "./helpers";

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

  const guardianNetwork = new GuardianNetwork();

  // const chainNames = ["ethereum", "bsc", "avalanche", "moonbeam"];
  const chainNames: ValidNetworks[] = ["ethereum", "bsc"];

  for (let i = 0; i < chainNames.length; ++i) {
    for (let j = i + 1; j < chainNames.length; ++j) {
      const pingChainName = chainNames[i];
      const pongChainName = chainNames[j];

      describe(`${pingChainName} <> ${pongChainName}`, () => {
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
        const pingOrderRouter = new OrderRouter(pingEnv.orderRouterAddress);

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
        const pongOrderRouter = new OrderRouter(pongEnv.orderRouterAddress);

        let usdc: IERC20;

        it(`Network: ${pingChainName} -- Mint USDC`, async () => {
          const result = await mintNativeUsdc(
            pingWallet,
            USDC_ADDRESSES[pingChainName],
            pingWallet.address,
            "1000000000"
          );
          usdc = result.usdc;
        });

        it(`Network: ${pingChainName} -- Place Market Order`, async () => {
          const amount = "100000000";
          await usdc
            .approve(pingOrderRouter.address, amount)
            .then((tx) => mineWait(pingProvider, tx));

          const receipt = await pingOrderRouter
            .placeMarketOrder(pingWallet, {
              amountIn: "100000000",
              minAmountOut: "1",
              targetChain: coalesceChainId(pongChainName),
              redeemer: tryNativeToUint8Array(
                pongWallet.address,
                pingChainName
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
          const signedVaa = await guardianNetwork.observeEvm(
            pingProvider,
            pingChainName,
            receipt
          );
          console.log(signedVaa.toString("hex"));
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
