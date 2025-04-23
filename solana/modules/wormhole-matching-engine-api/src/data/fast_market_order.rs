use bytemuck::{Pod, Zeroable};

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use solana_program::keccak;
use wormhole_svm_definitions::make_anchor_discriminator;

/// An account that represents a fast market order vaa. It is created by the signer of the transaction, and owned by the matching engine program.
/// The of the account is able to close this account and redeem the lamports deposited into the account (for rent)
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct FastMarketOrder {
    /// The amount of tokens sent from the source chain via the fast transfer
    pub amount_in: u64,
    /// The minimum amount of tokens to be received on the target chain via the fast transfer
    pub min_amount_out: u64,
    /// The deadline of the auction
    pub deadline: u32,
    /// The target chain (represented as a wormhole chain id)
    pub target_chain: u16,
    /// The length of the redeemer message
    pub redeemer_message_length: u16,
    /// The redeemer of the fast transfer (on the destination chain)
    pub redeemer: [u8; 32],
    /// The sender of the fast transfer (on the source chain)
    pub sender: [u8; 32],
    /// The refund address of the fast transfer
    pub refund_address: [u8; 32],
    /// The maximum fee of the fast transfer
    pub max_fee: u64,
    /// The initial auction fee of the fast transfer
    pub init_auction_fee: u64,
    /// The redeemer message of the fast transfer
    pub redeemer_message: [u8; 512],
    /// The refund recipient for the creator of the fast market order account
    pub close_account_refund_recipient: [u8; 32],
    /// The emitter address of the fast transfer
    pub vaa_emitter_address: [u8; 32],
    /// The sequence of the fast transfer vaa
    pub vaa_sequence: u64,
    /// The timestamp of the fast transfer vaa
    pub vaa_timestamp: u32,
    /// The vaa nonce, which is not used and can be set to 0
    pub vaa_nonce: u32,
    /// The source chain of the fast transfer vaa (represented as a wormhole chain id)
    pub vaa_emitter_chain: u16,
    /// The consistency level of the fast transfer vaa
    pub vaa_consistency_level: u8,
    /// Not used, but required for bytemuck serialisation
    _padding: [u8; 5],
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
    pub close_account_refund_recipient: [u8; 32],
    pub vaa_sequence: u64,
    pub vaa_timestamp: u32,
    pub vaa_nonce: u32,
    pub vaa_emitter_chain: u16,
    pub vaa_consistency_level: u8,
    pub vaa_emitter_address: [u8; 32],
}

impl FastMarketOrder {
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
            vaa_nonce: params.vaa_nonce,
            vaa_emitter_chain: params.vaa_emitter_chain,
            vaa_consistency_level: params.vaa_consistency_level,
            vaa_emitter_address: params.vaa_emitter_address,
            _padding: [0_u8; 5],
        }
    }

    pub const SEED_PREFIX: &'static [u8] = b"fast_market_order";

    /// Convert the fast market order to a vec of bytes (without the discriminator)
    pub fn to_vec(&self) -> Vec<u8> {
        let payload_slice = bytemuck::bytes_of(self);
        let mut payload = Vec::with_capacity(payload_slice.len());
        payload.extend_from_slice(payload_slice);
        payload
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

    /// A double hash of the serialised fast market order. Used for seeds and verification.
    pub fn digest(&self) -> [u8; 32] {
        let message_hash = keccak::hashv(&[
            self.vaa_timestamp.to_be_bytes().as_ref(),
            self.vaa_nonce.to_be_bytes().as_ref(),
            self.vaa_emitter_chain.to_be_bytes().as_ref(),
            &self.vaa_emitter_address,
            &self.vaa_sequence.to_be_bytes(),
            &[self.vaa_consistency_level],
            self.payload().as_ref(),
        ]);
        // Digest is the hash of the message
        keccak::hashv(&[message_hash.as_ref()])
            .as_ref()
            .try_into()
            .unwrap()
    }

    /// Read from an account info
    pub fn try_read(data: &[u8]) -> Result<&Self> {
        if data.len() < 8 {
            return Err(ErrorCode::AccountDiscriminatorNotFound.into());
        }
        let discriminator: [u8; 8] = data[0..8].try_into().unwrap();
        if discriminator != Self::discriminator() {
            return Err(ErrorCode::AccountDiscriminatorMismatch.into());
        }
        let byte_muck_data = &data[8..];
        let fast_market_order = bytemuck::from_bytes::<Self>(byte_muck_data);
        Ok(fast_market_order)
    }
}

impl Discriminator for FastMarketOrder {
    const DISCRIMINATOR: [u8; 8] = make_anchor_discriminator(Self::SEED_PREFIX);
}

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct InitialiseFastMarketOrderData {
    /// The fast market order as the bytemuck struct
    pub fast_market_order: FastMarketOrder,
    /// The guardian set bump
    pub guardian_set_bump: u8,
    /// Padding to ensure bytemuck deserialization works
    _padding: [u8; 7],
}

impl InitialiseFastMarketOrderData {
    /// Creates a new InitialiseFastMarketOrderData with padding
    pub fn new(fast_market_order: FastMarketOrder, guardian_set_bump: u8) -> Self {
        Self {
            fast_market_order,
            guardian_set_bump,
            _padding: [0_u8; 7],
        }
    }

    /// Deserializes the InitialiseFastMarketOrderData from a byte slice
    ///
    /// # Arguments
    ///
    /// * `data` - A byte slice containing the InitialiseFastMarketOrderData
    ///
    /// # Returns
    ///
    /// Option<&Self> - The deserialized InitialiseFastMarketOrderData or None if the byte slice is not the correct length
    pub fn from_bytes(data: &[u8]) -> Option<&Self> {
        bytemuck::try_from_bytes::<Self>(data).ok()
    }
}
