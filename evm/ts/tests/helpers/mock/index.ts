import { Chain } from "@wormhole-foundation/sdk";
import { ethers } from "ethers";

export * from "./circleAttester";
export * from "./wormhole";

export abstract class EvmObserver<T> {
    abstract observeEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ): T;

    abstract observeManyEvm(
        provider: ethers.providers.Provider,
        chain: Chain,
        txReceipt: ethers.ContractReceipt,
    ): T[];
}
