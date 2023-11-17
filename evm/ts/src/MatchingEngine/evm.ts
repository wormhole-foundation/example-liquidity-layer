import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { AuctionConfig, MatchingEngine } from ".";
import { LiquidityLayerTransactionResult } from "..";
import {
    ICircleIntegration,
    ICircleIntegration__factory,
    IMatchingEngine,
    IMatchingEngine__factory,
    IWormhole,
    IWormhole__factory,
} from "../types";

export class EvmMatchingEngine implements MatchingEngine<ethers.ContractTransaction> {
    contract: IMatchingEngine;

    // Cached contracts.
    cache?: {
        chainId: ChainId;
        wormholeCctp: ICircleIntegration;
        coreBridge: IWormhole;
        circleTransmitterAddress?: string;
    };

    constructor(connection: ethers.Signer | ethers.providers.Provider, contractAddress: string) {
        this.contract = IMatchingEngine__factory.connect(contractAddress, connection);
    }

    get address(): string {
        return this.contract.address;
    }

    async addRouterEndpoint(chain: number, router: string): Promise<ethers.ContractTransaction> {
        return this.contract.addRouterEndpoint(chain, router);
    }

    async setAuctionConfig(config: AuctionConfig): Promise<ethers.ContractTransaction> {
        return this.contract.setAuctionConfig(config);
    }

    async getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult> {
        // Check cached contracts.
        const { chainId, wormholeCctp, coreBridge, circleTransmitterAddress } =
            await this._cacheIfNeeded();

        return this.contract.provider
            .getTransactionReceipt(txHash)
            .then((txReceipt) =>
                LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
                    chainId,
                    coreBridge.address,
                    wormholeCctp.address,
                    txReceipt,
                    circleTransmitterAddress
                )
            );
    }

    private async _cacheIfNeeded() {
        if (this.cache === undefined) {
            const provider = this.contract.provider;
            const wormholeCctp = await this.contract
                .wormholeCctp()
                .then((addr) => ICircleIntegration__factory.connect(addr, provider));
            const coreBridge = await wormholeCctp
                .wormhole()
                .then((addr) => IWormhole__factory.connect(addr, provider));
            const circleTransmitterAddress =
                wormholeCctp.address == ethers.constants.AddressZero
                    ? undefined
                    : await wormholeCctp.circleTransmitter();

            // If this isn't a recognized ChainId, we have problems.
            const chainId = await coreBridge.chainId();

            this.cache = {
                chainId: chainId as ChainId,
                wormholeCctp,
                coreBridge,
                circleTransmitterAddress,
            };
        }

        return this.cache;
    }
}
