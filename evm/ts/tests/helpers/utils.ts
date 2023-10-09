import { TokenImplementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { ethers } from "ethers";
import {
  IERC20__factory,
  ITokenBridge__factory,
  IUSDC__factory,
} from "../../src/types";
import { WALLET_PRIVATE_KEYS } from "./consts";
import {
  coalesceChainId,
  tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";

export async function mineWait(
  provider: ethers.providers.StaticJsonRpcProvider,
  tx: ethers.ContractTransaction
) {
  await provider.send("evm_mine", []);
  return tx.wait();
}

export async function mineWaitWut(
  provider: ethers.providers.StaticJsonRpcProvider,
  txs: ethers.ContractTransaction[]
) {
  await provider.send("evm_mine", []);
  return Promise.all(txs.map((tx) => tx.wait()));
}

export async function mintWrappedTokens(
  providerOrSigner: ethers.providers.StaticJsonRpcProvider | ethers.Signer,
  tokenBridgeAddress: string,
  tokenChain: "ethereum" | "polygon",
  tokenAddress: string,
  recipient: string,
  amount: ethers.BigNumberish
) {
  const wrappedToken = await ITokenBridge__factory.connect(
    tokenBridgeAddress,
    providerOrSigner
  )
    .wrappedAsset(
      coalesceChainId(tokenChain),
      tryNativeToUint8Array(tokenAddress, tokenChain)
    )
    .then((addr) => IERC20__factory.connect(addr, providerOrSigner));

  const provider = (
    "provider" in providerOrSigner
      ? providerOrSigner.provider!
      : providerOrSigner
  ) as ethers.providers.StaticJsonRpcProvider;
  await provider.send("anvil_impersonateAccount", [tokenBridgeAddress]);
  await provider.send("anvil_setBalance", [
    tokenBridgeAddress,
    ethers.BigNumber.from("1000000000000000000")._hex,
  ]);

  const tokenImplementation = TokenImplementation__factory.connect(
    wrappedToken.address,
    provider.getSigner(tokenBridgeAddress)
  );
  await tokenImplementation
    .mint(recipient, amount)
    .then((tx) => mineWait(provider, tx));

  await provider.send("anvil_stopImpersonatingAccount", [tokenBridgeAddress]);

  return { wrappedToken };
}

export async function mintNativeUsdc(
  providerOrSigner: ethers.providers.StaticJsonRpcProvider | ethers.Signer,
  usdcAddress: string,
  recipient: string,
  amount: ethers.BigNumberish
) {
  const provider = (
    "provider" in providerOrSigner
      ? providerOrSigner.provider!
      : providerOrSigner
  ) as ethers.providers.StaticJsonRpcProvider;
  await IUSDC__factory.connect(
    usdcAddress,
    new ethers.Wallet(WALLET_PRIVATE_KEYS[9], provider)
  )
    .mint(recipient, amount)
    .then((tx) => mineWait(provider, tx));

  return { usdc: IERC20__factory.connect(usdcAddress, providerOrSigner) };
}
