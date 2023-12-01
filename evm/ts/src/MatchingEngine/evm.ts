import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { AuctionConfig, LiveAuctionData, MatchingEngine, RedeemParameters } from ".";
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

    get signer(): ethers.Signer {
        return this.contract.signer;
    }

    get signerAddress(): Promise<string> {
        return this.contract.signer.getAddress();
    }

    get provider(): ethers.providers.Provider {
        return this.contract.provider;
    }

    connect(connection: ethers.Signer | ethers.providers.Provider): EvmMatchingEngine {
        return new EvmMatchingEngine(connection, this.address);
    }

    async addRouterEndpoint(chain: number, router: string): Promise<ethers.ContractTransaction> {
        return this.contract.addRouterEndpoint(chain, router);
    }

    async setAuctionConfig(config: AuctionConfig): Promise<ethers.ContractTransaction> {
        return this.contract.setAuctionConfig(config);
    }

    async placeInitialBid(
        fastTransferVaa: Buffer | Uint8Array,
        feeBid: bigint | ethers.BigNumberish
    ): Promise<ethers.ContractTransaction> {
        return this.contract.placeInitialBid(fastTransferVaa, feeBid);
    }

    async improveBid(
        auctionId: Buffer | Uint8Array,
        feeBid: bigint | ethers.BigNumberish
    ): Promise<ethers.ContractTransaction> {
        return this.contract.improveBid(auctionId, feeBid);
    }

    async executeFastOrder(
        fastTransferVaa: Buffer | Uint8Array
    ): Promise<ethers.ContractTransaction> {
        return this.contract.executeFastOrder(fastTransferVaa);
    }

    async executeSlowOrderAndRedeem(
        fastTransferVaa: Buffer | Uint8Array,
        params: RedeemParameters
    ): Promise<ethers.ContractTransaction> {
        return this.contract.executeSlowOrderAndRedeem(fastTransferVaa, params);
    }

    async calculateDynamicPenalty(
        auctionId?: Buffer | Uint8Array,
        amount?: bigint | ethers.BigNumberish,
        blocksElapsed?: bigint | ethers.BigNumberish
    ): Promise<[ethers.BigNumberish, ethers.BigNumberish]> {
        if (auctionId !== undefined) {
            return this.contract["calculateDynamicPenalty(bytes32)"](auctionId);
        } else if (amount !== undefined && blocksElapsed !== undefined) {
            return this.contract["calculateDynamicPenalty(uint256,uint256)"](amount, blocksElapsed);
        } else {
            throw new Error("Invalid arguments");
        }
    }

    async liveAuctionInfo(auctionId: Buffer | Uint8Array): Promise<LiveAuctionData> {
        return this.contract.liveAuctionInfo(auctionId);
    }

    async auctionStatus(auctionId: Buffer | Uint8Array): Promise<number> {
        return this.contract.liveAuctionInfo(auctionId).then((res) => res.status);
    }

    async getAuctionGracePeriod(): Promise<number> {
        return this.contract.getAuctionGracePeriod();
    }

    async getAuctionDuration(): Promise<number> {
        return this.contract.getAuctionDuration();
    }

    async getAuctionConfig(): Promise<AuctionConfig> {
        return this.contract.auctionConfig();
    }

    async wormhole(): Promise<string> {
        return this.contract.wormhole();
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
                    this.address,
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
