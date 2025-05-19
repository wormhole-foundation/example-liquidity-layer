use anchor_lang::prelude::*;
use solana_program::keccak;

/// An account that represents a fast market order VAA. It is created by the
/// payer of the transaction. This payer is the only authority that can close
/// this account and receive its rent.
#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct FastMarketOrder {
    /// The amount of tokens sent from the source chain via the fast transfer.
    pub amount_in: u64,
    /// The minimum amount of tokens to be received on the target chain via the
    /// fast transfer.
    pub min_amount_out: u64,
    /// The deadline of the auction.
    pub deadline: u32,
    /// The target chain (represented as a Wormhole chain ID).
    pub target_chain: u16,
    /// The length of the redeemer message.
    pub redeemer_message_length: u16,
    /// The redeemer of the fast transfer (on the destination chain).
    pub redeemer: [u8; 32],
    /// The sender of the fast transfer (on the source chain).
    pub sender: [u8; 32],
    /// The refund address of the fast transfer.
    pub refund_address: [u8; 32],
    /// The maximum fee of the fast transfer.
    pub max_fee: u64,
    /// The initial auction fee of the fast transfer.
    pub init_auction_fee: u64,
    /// The redeemer message of the fast transfer.
    ///
    /// NOTE: This value is based on the max redeemer length of 500 bytes that
    /// is specified in the token router program. If this changes in the future,
    /// this value must be updated.
    pub redeemer_message: [u8; 512],
    /// The refund recipient for the creator of the fast market order account.
    pub close_account_refund_recipient: Pubkey,
    /// The emitter address of the fast transfer
    pub vaa_emitter_address: [u8; 32],
    /// The sequence of the fast transfer VAA.
    pub vaa_sequence: u64,
    /// The timestamp of the fast transfer VAA.
    pub vaa_timestamp: u32,
    /// The source chain of the fast transfer VAA. (represented as a Wormhole
    /// chain ID).
    pub vaa_emitter_chain: u16,
    /// The consistency level of the fast transfer VAA.
    pub vaa_consistency_level: u8,
    /// Not used, but required for bytemuck serialization.
    _padding: [u8; 1],
}

pub struct FastMarketOrderParams {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub deadline: u32,
    pub target_chain: u16,
    pub redeemer_message_length: u16,
    pub redeemer: [u8; 32],
    pub sender: [u8; 32],
    pub refund_address: [u8; 32],
    pub max_fee: u64,
    pub init_auction_fee: u64,
    pub redeemer_message: [u8; 512],
    pub close_account_refund_recipient: Pubkey,
    pub vaa_sequence: u64,
    pub vaa_timestamp: u32,
    pub vaa_emitter_chain: u16,
    pub vaa_consistency_level: u8,
    pub vaa_emitter_address: [u8; 32],
}

impl FastMarketOrder {
    pub const SEED_PREFIX: &'static [u8] = b"fast_market_order";

    pub fn new(params: FastMarketOrderParams) -> Self {
        Self {
            amount_in: params.amount_in,
            min_amount_out: params.min_amount_out,
            deadline: params.deadline,
            target_chain: params.target_chain,
            redeemer_message_length: params.redeemer_message_length,
            redeemer: params.redeemer,
            sender: params.sender,
            refund_address: params.refund_address,
            max_fee: params.max_fee,
            init_auction_fee: params.init_auction_fee,
            redeemer_message: params.redeemer_message,
            close_account_refund_recipient: params.close_account_refund_recipient,
            vaa_sequence: params.vaa_sequence,
            vaa_timestamp: params.vaa_timestamp,
            vaa_emitter_chain: params.vaa_emitter_chain,
            vaa_consistency_level: params.vaa_consistency_level,
            vaa_emitter_address: params.vaa_emitter_address,
            _padding: [0_u8; 1],
        }
    }

    /// Creates an payload as expected in a fast market order vaa
    pub fn payload(&self) -> Vec<u8> {
        let mut payload = vec![];
        payload.push(11_u8); // This is the payload id for a fast market order
        payload.extend_from_slice(&self.amount_in.to_be_bytes());
        payload.extend_from_slice(&self.min_amount_out.to_be_bytes());
        payload.extend_from_slice(&self.target_chain.to_be_bytes());
        payload.extend_from_slice(&self.redeemer);
        payload.extend_from_slice(&self.sender);
        payload.extend_from_slice(&self.refund_address);
        payload.extend_from_slice(&self.max_fee.to_be_bytes());
        payload.extend_from_slice(&self.init_auction_fee.to_be_bytes());
        payload.extend_from_slice(&self.deadline.to_be_bytes());
        payload.extend_from_slice(&self.redeemer_message_length.to_be_bytes());
        if self.redeemer_message_length > 0 {
            payload.extend_from_slice(
                &self.redeemer_message[..usize::from(self.redeemer_message_length)],
            );
        }
        payload
    }

    /// A double hash of the serialised fast market order. Used for seeds and
    /// verification.
    // TODO: Change return type to keccak::Hash
    pub fn digest(&self) -> [u8; 32] {
        wormhole_svm_definitions::compute_keccak_digest(
            keccak::hashv(&[
                &self.vaa_timestamp.to_be_bytes(),
                // The nonce is 0
                &0_u32.to_be_bytes(),
                &self.vaa_emitter_chain.to_be_bytes(),
                &self.vaa_emitter_address,
                &self.vaa_sequence.to_be_bytes(),
                &[self.vaa_consistency_level],
                &self.payload(),
            ]),
            None,
        )
        .0
    }
}
