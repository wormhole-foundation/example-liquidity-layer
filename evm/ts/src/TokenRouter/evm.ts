import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { Endpoint, OrderResponse, TokenRouter, FastTransferParameters } from ".";
import { LiquidityLayerTransactionResult } from "..";
import {
    ITokenRouter,
    ITokenRouter__factory,
    IWormhole,
    IWormhole__factory,
    ITokenMessenger__factory,
    ITokenMessenger,
} from "../types";

export class EvmTokenRouter implements TokenRouter<ethers.ContractTransaction> {
    contract: ITokenRouter;
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
        this.contract = ITokenRouter__factory.connect(contractAddress, connection);
        this.circle = ITokenMessenger__factory.connect(circleBridge, connection);
    }

    get address(): string {
        return this.contract.address;
    }

    placeMarketOrder(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        minAmountOut?: bigint,
        refundAddress?: string
    ) {
        if (minAmountOut !== undefined && refundAddress !== undefined) {
            return this.contract["placeMarketOrder(uint64,uint64,uint16,bytes32,bytes,address)"](
                amountIn,
                minAmountOut,
                targetChain,
                redeemer,
                redeemerMessage,
                refundAddress
            );
        } else {
            return this.contract["placeMarketOrder(uint64,uint16,bytes32,bytes)"](
                amountIn,
                targetChain,
                redeemer,
                redeemerMessage
            );
        }
    }

    placeFastMarketOrder(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint,
        refundAddress?: string
    ) {
        if (minAmountOut !== undefined && refundAddress !== undefined) {
            return this.contract[
                "placeFastMarketOrder(uint64,uint64,uint16,bytes32,bytes,address,uint64,uint32)"
            ](
                amountIn,
                minAmountOut,
                targetChain,
                redeemer,
                redeemerMessage,
                refundAddress,
                maxFee,
                deadline
            );
        } else {
            return this.contract["placeFastMarketOrder(uint64,uint16,bytes32,bytes,uint64,uint32)"](
                amountIn,
                targetChain,
                redeemer,
                redeemerMessage,
                maxFee,
                deadline
            );
        }
    }

    redeemFill(response: OrderResponse) {
        return this.contract.redeemFill(response);
    }

    addRouterEndpoint(chain: number, endpoint: Endpoint, domain: number) {
        return this.contract.addRouterEndpoint(chain, endpoint, domain);
    }

    updateFastTransferParameters(newParams: FastTransferParameters) {
        return this.contract.updateFastTransferParameters(newParams);
    }

    enableFastTransfer(enable: boolean) {
        return this.contract.enableFastTransfers(enable);
    }

    async getRouter(chain: number): Promise<string> {
        return this.contract.getRouter(chain);
    }

    async getInitialAuctionFee(): Promise<ethers.BigNumber> {
        return this.contract.getInitialAuctionFee();
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
