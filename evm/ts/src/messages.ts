import { parseVaa as _parseVaa } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

const TOKEN_BRIDGE_INTEGRATOR_MESSAGE_IDX = 133;
const WORMHOLE_CCTP_INTEGRATOR_MESSAGE_IDX = 147;

export enum RevertType {
  SwapFailed,
}

export type LiquidityLayerMessage = {
  marketOrder?: MarketOrder;
  fill?: Fill;
  orderRevert?: OrderRevert;
};

export class MessageDecoder {
  tokenBridgeAddress: Buffer | Uint8Array;
  wormholeCctpAddress?: Buffer | Uint8Array;

  constructor(
    tokenBridgeAddress: Buffer | Uint8Array,
    wormholeCctpAddress?: Buffer | Uint8Array
  ) {
    this.tokenBridgeAddress = tokenBridgeAddress;
    this.wormholeCctpAddress = wormholeCctpAddress;
  }

  static decode(payload: Buffer): LiquidityLayerMessage {
    const payloadId = payload.readUInt8(0);
    switch (payloadId) {
      case MarketOrder.ID: {
        return { marketOrder: MarketOrder.decode(payload) };
      }
      case Fill.ID: {
        return { fill: Fill.decode(payload) };
      }
      case OrderRevert.ID: {
        return { orderRevert: OrderRevert.decode(payload) };
      }
      default: {
        throw new Error(`Invalid payload ID: ${payloadId}`);
      }
    }
  }

  decodeCoreBridgeMessage(
    emitterAddress: Buffer | Uint8Array,
    messagePayload: Buffer | Uint8Array
  ) {
    const emitter = Buffer.from(emitterAddress);
    if (emitter.equals(this.tokenBridgeAddress)) {
      return MessageDecoder.unsafeDecodeTokenBridgeTransferPayload(
        messagePayload
      );
    } else if (
      this.wormholeCctpAddress !== undefined &&
      emitter.equals(this.wormholeCctpAddress)
    ) {
      return MessageDecoder.unsafeDecodeWormholeCctpPayload(messagePayload);
    } else {
      throw new Error("unrecognized emitter");
    }
  }
  parseVaa(encodedVaa: Buffer) {
    const vaa = _parseVaa(encodedVaa);

    // TODO: return the token bridge or wormhole cctp message?

    return {
      vaa,
      decoded: this.decodeCoreBridgeMessage(vaa.emitterAddress, vaa.payload),
    };
  }

  static unsafeDecodeTokenBridgeTransferPayload(
    tokenBridgeMessage: Buffer | Uint8Array
  ) {
    return this.decode(
      Buffer.from(tokenBridgeMessage).subarray(
        TOKEN_BRIDGE_INTEGRATOR_MESSAGE_IDX
      )
    );
  }

  static unsafeDecodeWormholeCctpPayload(
    wormholeCctpMessage: Buffer | Uint8Array
  ) {
    return this.decode(
      Buffer.from(wormholeCctpMessage).subarray(
        WORMHOLE_CCTP_INTEGRATOR_MESSAGE_IDX
      )
    );
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
