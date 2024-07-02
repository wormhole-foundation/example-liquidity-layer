import {
    FastTransfer,
    TokenRouter,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Network, toChainId } from "@wormhole-foundation/sdk-base";
import { Contracts, UnsignedTransaction } from "@wormhole-foundation/sdk-definitions";
import {
    AnyEvmAddress,
    EvmAddress,
    EvmChains,
    EvmUnsignedTransaction,
} from "@wormhole-foundation/sdk-evm";
import { ethers } from "ethers";
import { OrderResponse, TokenRouter as _TokenRouter, encodeOrderResponse } from "../TokenRouter";
import { IUSDC__factory } from "../types";

export class EvmTokenRouter<N extends Network, C extends EvmChains>
    extends _TokenRouter
    implements TokenRouter<N, C>
{
    constructor(
        readonly network: N,
        readonly chain: C,
        readonly provider: ethers.Provider,
        readonly contracts: Contracts & TokenRouter.Addresses,
    ) {
        super(provider, contracts.tokenRouter, contracts.cctp.tokenMessenger);
    }

    async *approveAllowance(sender: AnyEvmAddress, amount: bigint) {
        const from = new EvmAddress(sender).unwrap();

        const tokenContract = IUSDC__factory.connect(this.contracts.cctp.usdcMint, this.provider);
        const allowed = await tokenContract.allowance(from, this.address);

        if (amount > allowed) {
            const txReq = await tokenContract.approve.populateTransaction(this.address, amount);
            yield this.createUnsignedTx(
                { ...txReq, from },
                "MatchingEngine.approveAllowance",
                false,
            );
        }
    }

    async *placeMarketOrder(sender: AnyEvmAddress, order: TokenRouter.OrderRequest) {
        const from = new EvmAddress(sender).unwrap();
        const msg = order.redeemerMessage ? order.redeemerMessage : new Uint8Array();

        const refundAddress = order.refundAddress
            ? new EvmAddress(order.refundAddress).unwrap()
            : undefined;

        yield* this.approveAllowance(sender, order.amountIn + (order.maxFee || 0n));

        const txReq = await this.placeMarketOrderTx(
            order.amountIn,
            toChainId(order.targetChain),
            order.redeemer.toUint8Array(),
            msg,
            order.minAmountOut,
            refundAddress,
        );

        yield this.createUnsignedTx({ ...txReq, from }, "TokenRouter.placeMarketOrder");
    }

    async *placeFastMarketOrder(sender: AnyEvmAddress, order: TokenRouter.OrderRequest) {
        const from = new EvmAddress(sender).unwrap();
        const msg = order.redeemerMessage ? order.redeemerMessage : new Uint8Array();

        const refundAddress = order.refundAddress
            ? new EvmAddress(order.refundAddress).unwrap()
            : undefined;

        // If necessary, approve the amountIn to be spent by the TokenRouter.
        yield* this.approveAllowance(sender, order.amountIn + (order.maxFee || 0n));

        const txReq = await this.placeFastMarketOrderTx(
            order.amountIn,
            toChainId(order.targetChain),
            order.redeemer.toUint8Array(),
            msg,
            order.maxFee!,
            order.deadline!,
            order.minAmountOut,
            refundAddress,
        );

        yield this.createUnsignedTx({ ...txReq, from }, "TokenRouter.placeMarketOrder");
    }

    async *redeemFill(sender: AnyEvmAddress, orderResponse: FastTransfer.OrderResponse) {
        const from = new EvmAddress(sender).unwrap();

        const response: OrderResponse = encodeOrderResponse(orderResponse);
        const txReq = await this.redeemFillTx(response);
        yield this.createUnsignedTx({ ...txReq, from }, "TokenRouter.redeemFill");
    }

    private createUnsignedTx(
        txReq: ethers.TransactionRequest,
        description: string,
        parallelizable: boolean = false,
    ): UnsignedTransaction<N, C> {
        return new EvmUnsignedTransaction(
            txReq,
            this.network,
            this.chain,
            description,
            parallelizable,
        );
    }
}
