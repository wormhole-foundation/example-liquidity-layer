import { Chain } from "@wormhole-foundation/sdk-base";
import { ethers } from "ethers-v5";

export * from "./circleAttester";
export * from "./wormhole";

export abstract class EvmObserver<T> {
    abstract observeEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ): Promise<T>;

    abstract observeManyEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ): Promise<T[]>;
}
