import { parseVaa as _parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export enum RevertType {
  SwapFailed,
}

export class Message {
  tokenBridgeEmitterAddress: Buffer | Uint8Array;
  wormholeCctpEmitterAddress: Buffer | Uint8Array;

  constructor(
    tokenBridgeEmitterAddress: Buffer | Uint8Array,
    wormholeCctpEmitterAddress: Buffer | Uint8Array
  ) {
    this.tokenBridgeEmitterAddress = tokenBridgeEmitterAddress;
    this.wormholeCctpEmitterAddress = wormholeCctpEmitterAddress;
  }

  decode(payload: Buffer) {
    const payloadId = payload.readUInt8(0);
    switch (payloadId) {
      case MarketOrder.ID: {
        return { marketOrder: {}, message: MarketOrder.decode(payload) };
      }
      case Fill.ID: {
        return { fill: {}, message: Fill.decode(payload) };
      }
      case OrderRevert.ID: {
        return { orderRevert: {}, message: OrderRevert.decode(payload) };
      }
      default: {
        throw new Error(`Invalid payload ID: ${payloadId}`);
      }
    }
  }

  parseVaa(encodedVaa: Buffer) {
    const vaa = _parseVaa(encodedVaa);

    // TODO: return the token bridge or wormhole cctp message?

    const offset = (() => {
      if (vaa.emitterAddress.equals(this.tokenBridgeEmitterAddress)) {
        return 133;
      } else if (vaa.emitterAddress.equals(this.wormholeCctpEmitterAddress)) {
        return 147;
      } else {
        throw new Error("unrecognized emitter");
      }
    })();

    return {
      vaa,
      decoded: this.decode(vaa.payload.subarray(offset)),
    };
  }
}

export class MarketOrder {
  minAmountOut: bigint;
  targetChain: number;
  redeemer: Buffer;
  redeemerMessage: Buffer;
  sender: Buffer;
  refundAddress: Buffer;
  relayerFee: bigint;
  allowedRelayers: Buffer[];

  constructor(
    minAmountOut: bigint,
    targetChain: number,
    redeemer: Buffer,
    redeemerMessage: Buffer,
    sender: Buffer,
    refundAddress: Buffer,
    relayerFee: bigint,
    allowedRelayers: Buffer[]
  ) {
    this.minAmountOut = minAmountOut;
    this.targetChain = targetChain;
    this.redeemer = redeemer;
    this.redeemerMessage = redeemerMessage;
    this.sender = sender;
    this.refundAddress = refundAddress;
    this.relayerFee = relayerFee;
    this.allowedRelayers = allowedRelayers;
  }

  static get ID(): number {
    return 1;
  }

  static decode(payload: Buffer): MarketOrder {
    const buf = takePayloadId(payload, this.ID);

    const minAmountOut = BigInt(
      ethers.BigNumber.from(buf.subarray(0, 32)).toString()
    );
    const targetChain = buf.readUInt16BE(32);
    const redeemer = buf.subarray(34, 66);
    const sender = buf.subarray(66, 98);
    const refundAddress = buf.subarray(98, 130);
    const relayerFee = BigInt(
      ethers.BigNumber.from(buf.subarray(130, 162)).toString()
    );
    const allowedRelayersLen = buf.readUInt8(162);
    const allowedRelayers: Buffer[] = [];
    for (let i = 0; i < allowedRelayersLen; ++i) {
      const offset = 163 + i * 32;
      allowedRelayers.push(buf.subarray(offset, offset + 32));
    }

    const msgDataOffset = 163 + allowedRelayersLen * 32;
    const redeemerMsgLen = buf.readUInt32BE(msgDataOffset);
    const redeemerMessage = buf.subarray(
      4 + msgDataOffset,
      4 + msgDataOffset + redeemerMsgLen
    );

    return new MarketOrder(
      minAmountOut,
      targetChain,
      redeemer,
      redeemerMessage,
      sender,
      refundAddress,
      relayerFee,
      allowedRelayers
    );
  }
}

export class Fill {
  sourceChain: number;
  orderSender: Buffer;
  redeemer: Buffer;
  redeemerMessage: Buffer;

  constructor(
    sourceChain: number,
    orderSender: Buffer,
    redeemer: Buffer,
    redeemerMessage: Buffer
  ) {
    this.sourceChain = sourceChain;
    this.orderSender = orderSender;
    this.redeemer = redeemer;
    this.redeemerMessage = redeemerMessage;
  }

  static get ID(): number {
    return 16; // 0x10
  }

  static decode(payload: Buffer): Fill {
    const buf = takePayloadId(payload, this.ID);

    const sourceChain = buf.readUInt16BE(0);
    const orderSender = buf.subarray(2, 34);
    const redeemer = buf.subarray(34, 66);
    const redeemerMsgLen = buf.readUInt32BE(66);
    const redeemerMessage = buf.subarray(72, 72 + redeemerMsgLen);

    return new Fill(sourceChain, orderSender, redeemer, redeemerMessage);
  }
}

export class OrderRevert {
  reason: RevertType;
  refundAddress: Buffer;

  constructor(reason: RevertType, refundAddress: Buffer) {
    this.reason = reason;
    this.refundAddress = refundAddress;
  }

  static get ID(): number {
    return 32; // 0x20
  }

  static decode(payload: Buffer): OrderRevert {
    const buf = takePayloadId(payload, this.ID);

    const reason = buf.readUInt8(0) as RevertType;
    const refundAddress = buf.subarray(1, 33);

    return new OrderRevert(reason, refundAddress);
  }
}

function takePayloadId(buf: Buffer, expectedId: number): Buffer {
  if (buf.readUInt8(0) != expectedId) {
    throw new Error("Invalid payload ID");
  }

  return buf.subarray(1);
}
