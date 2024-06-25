import { ChainId, asChainId } from "@wormhole-foundation/sdk-base";
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
        private connection: ethers.Signer | ethers.Provider,
        readonly contractAddress: string,
        readonly circleBridge: string,
    ) {
        this.contract = ITokenRouter__factory.connect(contractAddress, connection);
        this.circle = ITokenMessenger__factory.connect(circleBridge, connection);
    }

    get address(): string {
        return this.contractAddress;
    }

    placeMarketOrderTx(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        minAmountOut?: bigint,
        refundAddress?: string,
    ) {
        if (minAmountOut !== undefined && refundAddress !== undefined) {
            return this.contract[
                "placeMarketOrder(uint64,uint64,uint16,bytes32,bytes,address)"
            ].populateTransaction(
                amountIn,
                minAmountOut,
                targetChain,
                redeemer,
                redeemerMessage,
                refundAddress,
            );
        } else {
            return this.contract[
                "placeMarketOrder(uint64,uint16,bytes32,bytes)"
            ].populateTransaction(amountIn, targetChain, redeemer, redeemerMessage);
        }
    }

    placeFastMarketOrderTx(
        amountIn: bigint,
        targetChain: number,
        redeemer: Buffer | Uint8Array,
        redeemerMessage: Buffer | Uint8Array,
        maxFee: bigint,
        deadline: number,
        minAmountOut?: bigint,
        refundAddress?: string,
    ) {
        if (minAmountOut !== undefined && refundAddress !== undefined) {
            return this.contract[
                "placeFastMarketOrder(uint64,uint64,uint16,bytes32,bytes,address,uint64,uint32)"
            ].populateTransaction(
                amountIn,
                minAmountOut,
                targetChain,
                redeemer,
                redeemerMessage,
                refundAddress,
                maxFee,
                deadline,
            );
        } else {
            return this.contract[
                "placeFastMarketOrder(uint64,uint16,bytes32,bytes,uint64,uint32)"
            ].populateTransaction(
                amountIn,
                targetChain,
                redeemer,
                redeemerMessage,
                maxFee,
                deadline,
            );
        }
    }

    redeemFillTx(response: OrderResponse) {
        return this.contract.redeemFill.populateTransaction(response);
    }

    addRouterEndpointTx(chain: number, endpoint: Endpoint, domain: number) {
        return this.contract.addRouterEndpoint.populateTransaction(chain, endpoint, domain);
    }

    updateFastTransferParametersTx(newParams: FastTransferParameters) {
        return this.contract.updateFastTransferParameters.populateTransaction(newParams);
    }

    enableFastTransferTx(enable: boolean) {
        return this.contract.enableFastTransfers.populateTransaction(enable);
    }

    async getRouter(chain: number): Promise<string> {
        return this.contract.getRouter(chain);
    }

    async getInitialAuctionFee() {
        return this.contract.getInitialAuctionFee();
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
            const provider = this.connection.provider!;
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
