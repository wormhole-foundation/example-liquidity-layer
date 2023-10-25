import {ChainId} from "@certusone/wormhole-sdk";
import {ethers} from "ethers";
import {OrderResponse, OrderRouter, PlaceMarketOrderArgs, RouterInfo, TokenType} from ".";
import {LiquidityLayerTransactionResult} from "..";
import {
    ICircleIntegration,
    ICircleIntegration__factory,
    IOrderRouter,
    IOrderRouter__factory,
    ITokenBridge,
    ITokenBridge__factory,
    IWormhole,
    IWormhole__factory,
} from "../types";

export class EvmOrderRouter implements OrderRouter<ethers.ContractTransaction> {
    contract: IOrderRouter;

    // Cached contracts.
    cache?: {
        chainId: ChainId;
        tokenBridge: ITokenBridge;
        wormholeCctp: ICircleIntegration;
        coreBridge: IWormhole;
        circleTransmitterAddress?: string;
    };

    constructor(connection: ethers.Signer | ethers.providers.Provider, contractAddress: string) {
        this.contract = IOrderRouter__factory.connect(contractAddress, connection);
    }

    get address(): string {
        return this.contract.address;
    }

    async computeMinAmountOut(
        amountIn: bigint,
        targetChain: number,
        slippage?: number,
        relayerFee?: bigint
    ): Promise<bigint> {
        if (relayerFee === undefined) {
            relayerFee = await this.defaultRelayerFee();
        }

        if (slippage === undefined) {
            slippage = await this.getRouterInfo(targetChain).then((info) => info.slippage);
        }

        const minAmountOut = await this.contract.computeMinAmountOut(
            amountIn,
            targetChain,
            slippage!,
            relayerFee
        );

        return BigInt(minAmountOut.toString());
    }

    placeMarketOrder(args: PlaceMarketOrderArgs, relayerFee?: bigint, allowedRelayers?: Buffer[]) {
        if (allowedRelayers !== undefined) {
            if (relayerFee === undefined) {
                throw new Error("relayerFee undefined");
            }
            return this.contract[
                "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address),uint256,bytes32[])"
            ](args, relayerFee, allowedRelayers);
        } else {
            return this.contract[
                "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address))"
            ](args);
        }
    }

    redeemFill(response: OrderResponse) {
        return this.contract.redeemFill(response);
    }

    tokenType() {
        return this.contract.tokenType();
    }

    addRouterInfo(chain: number, info: RouterInfo) {
        return this.contract.addRouterInfo(chain, info);
    }

    async defaultRelayerFee(): Promise<bigint> {
        return this.contract.defaultRelayerFee().then((fee) => BigInt(fee.toString()));
    }

    async getRouterInfo(chain: number): Promise<RouterInfo> {
        return this.contract.getRouterInfo(chain).then((info) => {
            return {
                endpoint: ethers.utils.arrayify(info.endpoint),
                tokenType: info.tokenType as TokenType,
                slippage: info.slippage,
            };
        });
    }

    async getTransactionResults(txHash: string): Promise<LiquidityLayerTransactionResult> {
        // Check cached contracts.
        const {chainId, wormholeCctp, coreBridge, circleTransmitterAddress} =
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
            const tokenBridge = await this.contract
                .tokenBridge()
                .then((addr) => ITokenBridge__factory.connect(addr, provider));
            const coreBridge = await tokenBridge
                .wormhole()
                .then((addr) => IWormhole__factory.connect(addr, provider));
            const wormholeCctp = await this.contract
                .wormholeCctp()
                .then((addr) => ICircleIntegration__factory.connect(addr, provider));
            const circleTransmitterAddress =
                wormholeCctp.address == ethers.constants.AddressZero
                    ? undefined
                    : await wormholeCctp.circleTransmitter();

            // If this isn't a recognized ChainId, we have problems.
            const chainId = await coreBridge.chainId();

            this.cache = {
                chainId: chainId as ChainId,
                tokenBridge,
                wormholeCctp,
                coreBridge,
                circleTransmitterAddress,
            };
        }

        return this.cache;
    }
}
