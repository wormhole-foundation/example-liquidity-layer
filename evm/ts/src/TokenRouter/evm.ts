import { ChainId } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { OrderResponse, TokenRouter, PlaceMarketOrderArgs, PlaceCctpMarketOrderArgs } from ".";
import { LiquidityLayerTransactionResult } from "..";
import {
    ICircleIntegration,
    ICircleIntegration__factory,
    ITokenRouter,
    ITokenRouter__factory,
    IWormhole,
    IWormhole__factory,
} from "../types";

export class EvmTokenRouter implements TokenRouter<ethers.ContractTransaction> {
    contract: ITokenRouter;

    // Cached contracts.
    cache?: {
        chainId: ChainId;
        wormholeCctp: ICircleIntegration;
        coreBridge: IWormhole;
        circleTransmitterAddress?: string;
    };

    constructor(connection: ethers.Signer | ethers.providers.Provider, contractAddress: string) {
        this.contract = ITokenRouter__factory.connect(contractAddress, connection);
    }

    get address(): string {
        return this.contract.address;
    }

    placeMarketOrder(args: PlaceMarketOrderArgs | PlaceCctpMarketOrderArgs) {
        if ("minAmountOut" in args) {
            return this.contract[
                "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address))"
            ](args);
        } else {
            return this.contract["placeMarketOrder((uint256,uint16,bytes32,bytes))"](args);
        }
    }

    redeemFill(response: OrderResponse) {
        return this.contract.redeemFill(response);
    }

    addRouterEndpoint(chain: number, info: string) {
        return this.contract.addRouterEndpoint(chain, info);
    }

    async getRouter(chain: number): Promise<string> {
        return this.contract.getRouter(chain);
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
