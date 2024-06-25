import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network } from "@wormhole-foundation/sdk-base";
import {
    AccountAddress,
    UnsignedTransaction,
    VAA,
    CircleBridge,
    Contracts,
} from "@wormhole-foundation/sdk-definitions";
import { EvmTokenRouter as _EvmTokenRouter } from "../TokenRouter";
import { ethers } from "ethers";

export class EvmTokenRouter<N extends Network, C extends Chain>
    extends _EvmTokenRouter
    implements TokenRouter<N, C>
{
    constructor(
        readonly network: N,
        readonly chain: C,
        readonly provider: ethers.providers.Provider,
        readonly contracts: Contracts & TokenRouter.Addresses,
    ) {
        super(provider, contracts.tokenRouter, contracts.cctp.tokenMessenger);
    }

    async *placeMarketOrder(
        sender: AccountAddress<C>,
        order: TokenRouter.OrderRequest | TokenRouter.PreparedOrder<C>,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
    async *redeemFill(
        sender: AccountAddress<C>,
        vaa:
            | VAA<"FastTransfer:CctpDeposit">
            | VAA<"FastTransfer:FastMarketOrder">
            | VAA<"FastTransfer:FastFill">,
        cctp: CircleBridge.Attestation,
    ): AsyncGenerator<UnsignedTransaction<N, C>, any, unknown> {
        throw new Error("Method not implemented.");
    }
}
