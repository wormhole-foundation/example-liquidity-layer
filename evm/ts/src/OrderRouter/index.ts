import { ethers } from "ethers";
import { IOrderRouter__factory } from "../types";

export enum TokenType {
  Unset,
  Native,
  Canonical,
  Cctp,
}

export type PlaceMarketOrderArgs = {
  amountIn: ethers.BigNumberish;
  minAmountOut: ethers.BigNumberish;
  targetChain: number;
  redeemer: ethers.BytesLike;
  redeemerMessage: ethers.BytesLike;
  refundAddress: string;
};

export type RouterInfo = {
  endpoint: ethers.BytesLike;
  tokenType: TokenType;
  slippage: number;
};

export class OrderRouter {
  address: string;

  constructor(contractAddress: string) {
    this.address = contractAddress;
  }

  placeMarketOrder(
    signer: ethers.Signer,
    args: PlaceMarketOrderArgs,
    relayerFee?: ethers.BigNumberish,
    allowedRelayers?: ethers.BytesLike[]
  ) {
    const router = IOrderRouter__factory.connect(this.address, signer);
    if (allowedRelayers !== undefined) {
      if (relayerFee === undefined) {
        throw new Error("relayerFee undefined");
      }
      return router[
        "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address),uint256,bytes32[])"
      ](args, relayerFee, allowedRelayers);
    } else if (relayerFee !== undefined) {
      return router[
        "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address),uint256)"
      ](args, relayerFee);
    } else {
      return router[
        "placeMarketOrder((uint256,uint256,uint16,bytes32,bytes,address))"
      ](args);
    }
  }

  addRouterInfo(owner: ethers.Signer, chain: number, info: RouterInfo) {
    const router = IOrderRouter__factory.connect(this.address, owner);
    return router.addRouterInfo(chain, info);
  }
}
