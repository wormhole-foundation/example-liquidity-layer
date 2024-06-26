import { Chain } from "@wormhole-foundation/sdk-base";
import { ethers } from "ethers";

export * from "./circleAttester";
export * from "./wormhole";

export abstract class EvmObserver<T> {
    abstract observeEvm(
        provider: ethers.Provider,
        chain: Chain,
        txReceipt: ethers.TransactionReceipt,
    ): Promise<T>;

    abstract observeManyEvm(
        provider: ethers.Provider,
        chain: Chain,
        txReceipt: ethers.TransactionReceipt,
    ): Promise<T[]>;
}
