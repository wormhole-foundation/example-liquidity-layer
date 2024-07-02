import { ChainId, asChainId } from "@wormhole-foundation/sdk-base";
import { ethers } from "ethers";
import { AbstractMatchingEngine, LiveAuctionData, RedeemParameters, RouterEndpoint } from ".";
import { LiquidityLayerTransactionResult } from "..";
import {
    IMatchingEngine,
    IMatchingEngine__factory,
    ITokenMessenger,
    ITokenMessenger__factory,
    IWormhole,
    IWormhole__factory,
} from "../types";

export class MatchingEngine implements AbstractMatchingEngine<ethers.ContractTransaction> {
    contract: IMatchingEngine;
    circle: ITokenMessenger;

    // Cached contracts.
    cache?: {
        chainId: ChainId;
        coreBridge: IWormhole;
        circleTransmitterAddress: string;
    };

    constructor(
        private connection: ethers.Provider,
        readonly contractAddress: string,
        readonly circleBridge: string,
    ) {
        this.contract = IMatchingEngine__factory.connect(contractAddress, connection);
        this.circle = ITokenMessenger__factory.connect(circleBridge, connection);
    }

    get address(): string {
        return this.contractAddress;
    }

    get provider(): ethers.Provider {
        return this.connection;
    }

    connect(connection: ethers.Provider): MatchingEngine {
        return new MatchingEngine(connection, this.address, this.circleBridge);
    }

    async addRouterEndpointTx(
        chain: number,
        endpoint: RouterEndpoint,
        domain: number,
    ): Promise<ethers.ContractTransaction> {
        return this.contract.addRouterEndpoint.populateTransaction(chain, endpoint, domain);
    }

    async placeInitialBidTx(
        fastTransferVaa: Buffer | Uint8Array,
        feeBid: bigint | ethers.BigNumberish,
    ): Promise<ethers.ContractTransaction> {
        return this.contract.placeInitialBid.populateTransaction(fastTransferVaa, feeBid);
    }

    async improveBidTx(
        auctionId: Buffer | Uint8Array,
        feeBid: bigint | ethers.BigNumberish,
    ): Promise<ethers.ContractTransaction> {
        return this.contract.improveBid.populateTransaction(auctionId, feeBid);
    }

    async executeFastOrderTx(
        fastTransferVaa: Buffer | Uint8Array,
    ): Promise<ethers.ContractTransaction> {
        return this.contract.executeFastOrder.populateTransaction(fastTransferVaa);
    }

    async executeSlowOrderAndRedeemTx(
        fastTransferVaa: Buffer | Uint8Array,
        params: RedeemParameters,
    ): Promise<ethers.ContractTransaction> {
        return this.contract.executeSlowOrderAndRedeem.populateTransaction(fastTransferVaa, params);
    }

    async calculateDynamicPenalty(
        auctionId?: Buffer | Uint8Array,
        amount?: bigint | ethers.BigNumberish,
        blocksElapsed?: bigint | ethers.BigNumberish,
    ): Promise<[bigint, bigint]> {
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

    async auctionStatus(auctionId: Buffer | Uint8Array) {
        return this.contract.liveAuctionInfo(auctionId).then((res) => res.status);
    }

    async getAuctionGracePeriod() {
        return this.contract.getAuctionGracePeriod();
    }

    async getAuctionDuration() {
        return this.contract.getAuctionDuration();
    }

    async getPenaltyBlocks() {
        return this.contract.getAuctionPenaltyBlocks();
    }

    async getInitialPenaltyBps() {
        return this.contract.getInitialPenaltyBps();
    }

    async getUserPenaltyRewardBps() {
        return this.contract.getUserPenaltyRewardBps();
    }

    async wormhole(): Promise<string> {
        return this.contract.wormhole();
    }

    async getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult> {
        // Check cached contracts.
        const { chainId, coreBridge, circleTransmitterAddress } = await this._cacheIfNeeded();

        const coreAddress = await coreBridge.getAddress();

        return this.connection
            .provider!.getTransactionReceipt(txHash)
            .then((txReceipt) =>
                LiquidityLayerTransactionResult.fromEthersTransactionReceipt(
                    chainId,
                    this.address,
                    coreAddress,
                    txReceipt!,
                    circleTransmitterAddress,
                ),
            );
    }

    private async _cacheIfNeeded() {
        if (this.cache === undefined) {
            const provider = this.connection;
            const coreBridge = await this.contract
                .wormhole()
                .then((addr) => IWormhole__factory.connect(addr, provider));
            const circleTransmitterAddress = await this.circle.localMessageTransmitter();

            // If this isn't a recognized ChainId, we have problems.
            const chainId = asChainId(Number(await coreBridge.chainId()));

            this.cache = { chainId, coreBridge, circleTransmitterAddress };
        }

        return this.cache;
    }
}
