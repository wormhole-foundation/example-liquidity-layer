import { ethers } from "ethers";
import {
  OrderResponse,
  OrderRouter,
  PlaceMarketOrderArgs,
  RouterInfo,
} from ".";
import { IOrderRouter, IOrderRouter__factory } from "../types";

type SignerOrProvider = ethers.Signer | ethers.providers.StaticJsonRpcProvider;

export class EvmOrderRouter implements OrderRouter<ethers.ContractTransaction> {
  connection: IOrderRouter;

  constructor(connection: SignerOrProvider, contractAddress: string) {
    this.connection = IOrderRouter__factory.connect(
      contractAddress,
      connection
    );
  }

  get address(): string {
    return this.connection.address;
  }

  placeMarketOrder(
    args: PlaceMarketOrderArgs,
    relayerFee?: bigint,
    allowedRelayers?: Buffer[]
  ) {
    if (allowedRelayers !== undefined) {
      if (relayerFee === undefined) {
        throw new Error("relayerFee undefined");
      }
      return this.connection[
        "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address),uint256,bytes32[])"
      ](args, relayerFee, allowedRelayers);
    } else {
      return this.connection[
        "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address))"
      ](args);
    }
  }

  redeemFill(response: OrderResponse) {
    return this.connection.redeemFill(response);
  }

  tokenType() {
    return this.connection.tokenType();
  }

  addRouterInfo(chain: number, info: RouterInfo) {
    return this.connection.addRouterInfo(chain, info);
  }
}
