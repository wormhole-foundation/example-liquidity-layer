import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Network, encoding, toChainId } from "@wormhole-foundation/sdk-base";
import {
    CircleBridge,
    Contracts,
    UnsignedTransaction,
    VAA,
    serialize,
} from "@wormhole-foundation/sdk-definitions";
import {
    AnyEvmAddress,
    EvmAddress,
    EvmChains,
    EvmUnsignedTransaction,
} from "@wormhole-foundation/sdk-evm";
import { ethers } from "ethers";
import { TokenRouter as _TokenRouter } from "../TokenRouter";

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

    async *placeMarketOrder(sender: AnyEvmAddress, order: TokenRouter.OrderRequest) {
        const from = new EvmAddress(sender).unwrap();
        const msg = order.redeemerMessage ? order.redeemerMessage : new Uint8Array();

        const refundAddress = order.refundAddress
            ? new EvmAddress(order.refundAddress).unwrap()
            : undefined;

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

    async *redeemFill(
        sender: AnyEvmAddress,
        vaa: VAA<"FastTransfer:CctpDeposit"> | VAA<"FastTransfer:FastFill">,
        cctp?: CircleBridge.Attestation,
    ) {
        const from = new EvmAddress(sender).unwrap();
        const txReq = await this.redeemFillTx({
            encodedWormholeMessage: serialize(vaa),
            circleBridgeMessage: cctp ? CircleBridge.serialize(cctp.message) : new Uint8Array(),
            circleAttestation: cctp ? encoding.hex.decode(cctp.attestation!) : new Uint8Array(),
        });
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
