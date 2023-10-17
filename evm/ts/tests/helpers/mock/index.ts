import { ChainName } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export * from "./circleAttester";
export * from "./wormhole";

export abstract class EvmObserver<T> {
  abstract observeEvm(
    provider: ethers.providers.Provider,
    chain: ChainName,
    txReceipt: ethers.ContractReceipt
  ): Promise<T>;
}
