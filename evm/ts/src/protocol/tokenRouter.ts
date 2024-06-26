import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Network, nativeChainIds, toChainId } from "@wormhole-foundation/sdk-base";
import {
    CircleBridge,
    Contracts,
    UnsignedTransaction,
    VAA,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnyEvmAddress,
    EvmAddress,
    EvmChains,
    EvmUnsignedTransaction,
} from "@wormhole-foundation/sdk-evm";
import { ethers } from "ethers";
import { EvmTokenRouter as _EvmTokenRouter } from "../TokenRouter";

export class EvmTokenRouter<N extends Network, C extends EvmChains>
    extends _EvmTokenRouter
    implements TokenRouter<N, C>
{
    private _chainId: number;
    constructor(
        readonly network: N,
        readonly chain: C,
        readonly provider: ethers.Provider,
        readonly contracts: Contracts & TokenRouter.Addresses,
    ) {
        super(provider, contracts.tokenRouter, contracts.cctp.tokenMessenger);
        this._chainId = 0; //nativeChainIds.networkChainToNativeChainId(network, chain);
    }

    async *placeMarketOrder(
        sender: AnyEvmAddress,
        order: TokenRouter.OrderRequest,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        const msg = order.redeemerMessage ? order.redeemerMessage : new Uint8Array();

        const refundAddress = order.refundAddress
            ? new EvmAddress(order.refundAddress).unwrap()
            : undefined;

        const tx = await this.placeMarketOrderTx(
            order.amountIn,
            toChainId(order.targetChain),
            order.redeemer.toUint8Array(),
            msg,
            order.minAmountOut,
            refundAddress,
        );

        yield this.createUnsignedTx(tx, "TokenRouter.placeMarketOrder");
    }
    async *redeemFill(
        sender: AnyEvmAddress,
        vaa:
            | VAA<"FastTransfer:CctpDeposit">
            | VAA<"FastTransfer:FastMarketOrder">
            | VAA<"FastTransfer:FastFill">,
        cctp: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }

    private createUnsignedTx(
        txReq: ethers.ContractTransaction,
        description: string,
        parallelizable: boolean = false,
    ): EvmUnsignedTransaction<N, C> {
        //txReq.chainId = this._chainId;

        return new EvmUnsignedTransaction(
            // txReq,
            {},
            this.network,
            this.chain,
            description,
            parallelizable,
        );
    }
}
