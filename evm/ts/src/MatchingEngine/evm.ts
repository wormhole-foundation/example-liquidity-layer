import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { RouterEndpoint, LiveAuctionData, MatchingEngine, RedeemParameters } from ".";
import { LiquidityLayerTransactionResult } from "..";
import {
    IMatchingEngine,
    IMatchingEngine__factory,
    ITokenMessenger,
    ITokenMessenger__factory,
    IWormhole,
    IWormhole__factory,
} from "../types";

export class EvmMatchingEngine implements MatchingEngine<ethers.ContractTransaction> {
    contract: IMatchingEngine;
    circle: ITokenMessenger;

    // Cached contracts.
    cache?: {
        chainId: ChainId;
        coreBridge: IWormhole;
        circleTransmitterAddress: string;
    };

    constructor(
        connection: ethers.Signer | ethers.providers.Provider,
        contractAddress: string,
        circleBridge: string
    ) {
        this.contract = IMatchingEngine__factory.connect(contractAddress, connection);
        this.circle = ITokenMessenger__factory.connect(circleBridge, connection);
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
        return new EvmMatchingEngine(connection, this.address, this.circle.address);
    }

    async addRouterEndpoint(
        chain: number,
        endpoint: RouterEndpoint,
        domain: number
    ): Promise<ethers.ContractTransaction> {
        return this.contract.addRouterEndpoint(chain, endpoint, domain);
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
            return this.contract["calculateDynamicPenalty(uint64,uint64)"](amount, blocksElapsed);
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

    async getPenaltyBlocks(): Promise<number> {
        return this.contract.getAuctionPenaltyBlocks();
    }

    async getInitialPenaltyBps(): Promise<number> {
        return this.contract.getInitialPenaltyBps();
    }

    async getUserPenaltyRewardBps(): Promise<number> {
        return this.contract.getUserPenaltyRewardBps();
    }

    async wormhole(): Promise<string> {
        return this.contract.wormhole();
    }

    async getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult> {
        // Check cached contracts.
        const { chainId, coreBridge, circleTransmitterAddress } = await this._cacheIfNeeded();

        return this.contract.provider
            .getTransactionReceipt(txHash)
            .then((txReceipt) =>
                LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
                    chainId,
                    this.address,
                    coreBridge.address,
                    txReceipt,
                    circleTransmitterAddress
                )
            );
    }

    private async _cacheIfNeeded() {
        if (this.cache === undefined) {
            const provider = this.contract.provider;
            const coreBridge = await this.contract
                .wormhole()
                .then((addr) => IWormhole__factory.connect(addr, provider));
            const circleTransmitterAddress = await this.circle.localMessageTransmitter();

            // If this isn't a recognized ChainId, we have problems.
            const chainId = await coreBridge.chainId();

            this.cache = {
                chainId: chainId as ChainId,
                coreBridge,
                circleTransmitterAddress,
            };
        }

        return this.cache;
    }
}
