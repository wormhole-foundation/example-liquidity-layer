import * as splToken from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { ChainId } from "@wormhole-foundation/sdk-base";
import { utils as coreUtils } from "@wormhole-foundation/sdk-solana-core";
import { Uint64, VaaHash, cctpMessageAddress, coreMessageAddress, writeUint64BE } from "../common";
import {
    Auction,
    AuctionConfig,
    AuctionHistory,
    Custodian,
    FastFill,
    FastFillSequencer,
    PreparedOrderResponse,
    Proposal,
    ReservedFastFillSequence,
    RouterEndpoint,
} from "./state";
import { VAA, keccak256 } from "@wormhole-foundation/sdk-definitions";

export function programDerivedAddresses(ID: PublicKey, mint: PublicKey, coreId: PublicKey) {
    return {
        auctionConfig: (id: number) => AuctionConfig.address(ID, id),
        auction: (vaaHash: VaaHash) => Auction.address(ID, vaaHash),
        coreMessage: (auction: PublicKey) => coreMessageAddress(ID, auction),
        cctpMessage: (auction: PublicKey) => cctpMessageAddress(ID, auction),
        preparedOrderResponse: (fastVaaHash: VaaHash) =>
            PreparedOrderResponse.address(ID, fastVaaHash),
        eventAuthority: () =>
            PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], ID)[0],
        custodian: () => Custodian.address(ID),
        cctpMintRecipient: (custodian: PublicKey) =>
            splToken.getAssociatedTokenAddressSync(mint, custodian, true),
        routerEndpoint: (chain: ChainId) => RouterEndpoint.address(ID, chain),
        preparedCustodyToken: (preparedOrderResponse: PublicKey) =>
            PublicKey.findProgramAddressSync(
                [Buffer.from("prepared-custody"), preparedOrderResponse.toBuffer()],
                ID,
            )[0],
        auctionCustodyToken: (auction: PublicKey) =>
            PublicKey.findProgramAddressSync(
                [Buffer.from("auction-custody"), auction.toBuffer()],
                ID,
            )[0],
        localCustodyToken: (sourceChain: ChainId) => {
            const encodedSourceChain = Buffer.alloc(2);
            encodedSourceChain.writeUInt16BE(sourceChain);

            return PublicKey.findProgramAddressSync(
                [Buffer.from("local-custody"), encodedSourceChain],
                ID,
            )[0];
        },
        proposal: (proposalId: Uint64) => Proposal.address(ID, proposalId),
        fastFill: (sourceChain: ChainId, orderSender: Array<number>, sequence: Uint64) =>
            FastFill.address(ID, sourceChain, orderSender, sequence),
        fastFillSequencer: (sourceChain: ChainId, sender: Array<number>) =>
            FastFillSequencer.address(ID, sourceChain, sender),
        reservedFastFillSequence: (fastVaaHash: VaaHash) =>
            ReservedFastFillSequence.address(ID, fastVaaHash),
        transferAuthority: (auction: PublicKey, offerPrice: Uint64) => {
            const encodedOfferPrice = Buffer.alloc(8);
            writeUint64BE(encodedOfferPrice, offerPrice);
            return PublicKey.findProgramAddressSync(
                [Buffer.from("transfer-authority"), auction.toBuffer(), encodedOfferPrice],
                ID,
            )[0];
        },
        auctionHistory: (id: Uint64) => AuctionHistory.address(ID, id),

        //
        postedVaa: (vaa: VAA<any>) => coreUtils.derivePostedVaaKey(coreId, Buffer.from(vaa.hash)),
    };
}
