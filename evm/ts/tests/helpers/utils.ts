import { TokenImplementation__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { ethers } from "ethers";
import {
  IERC20,
  IERC20__factory,
  ITokenBridge__factory,
  IUSDC__factory,
} from "../../src/types";
import { WALLET_PRIVATE_KEYS } from "./consts";
import {
  CONTRACTS,
  coalesceChainId,
  tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";

export async function mine(provider: ethers.providers.StaticJsonRpcProvider) {
  await provider.send("evm_mine", []);
}

export async function mineWait(
  provider: ethers.providers.StaticJsonRpcProvider,
  tx: ethers.ContractTransaction
) {
  await mine(provider);
  return tx.wait();
}

export async function mintWrappedTokens(
  providerOrSigner: ethers.providers.StaticJsonRpcProvider | ethers.Signer,
  tokenBridgeAddress: string,
  tokenChain: "ethereum" | "polygon" | "bsc",
  tokenAddress: Uint8Array | string,
  recipient: string,
  amount: ethers.BigNumberish
) {
  const wrappedToken = await ITokenBridge__factory.connect(
    tokenBridgeAddress,
    providerOrSigner
  )
    .wrappedAsset(
      coalesceChainId(tokenChain),
      typeof tokenAddress == "string"
        ? tryNativeToUint8Array(tokenAddress, tokenChain)
        : tokenAddress
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
  usdc: IERC20,
  recipient: string,
  amount: ethers.BigNumberish
) {
  if (!("detectNetwork" in usdc.provider)) {
    throw new Error("provider must be a StaticJsonRpcProvider");
  }

  const provider = usdc.provider as ethers.providers.StaticJsonRpcProvider;

  await IUSDC__factory.connect(
    usdc.address,
    new ethers.Wallet(WALLET_PRIVATE_KEYS[9], provider)
  )
    .mint(recipient, amount)
    .then((tx) => mineWait(provider, tx));
}

export async function burnAllUsdc(usdc: IERC20) {
  await usdc
    .balanceOf(usdc.signer.getAddress())
    .then((balance) =>
      usdc.transfer("0x6969696969696969696969696969696969696969", balance)
    )
    .then((tx) =>
      mineWait(usdc.provider as ethers.providers.StaticJsonRpcProvider, tx)
    );
}
