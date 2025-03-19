use anchor_lang::prelude::*;
use solana_program::keccak;

#[account(zero_copy)]
#[derive(Debug)]
#[repr(C)]
pub struct FastMarketOrder {
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
    pub refund_recipient: [u8; 32],
    pub vaa_emitter_address: [u8; 32],
    pub vaa_sequence: u64,
    pub vaa_timestamp: u32,
    pub vaa_nonce: u32,
    pub vaa_emitter_chain: u16,
    pub vaa_consistency_level: u8,
    _padding: [u8; 5],
}

impl FastMarketOrder {
    pub fn new(
        amount_in: u64,
        min_amount_out: u64,
        deadline: u32,
        target_chain: u16,
        redeemer_message_length: u16,
        redeemer: [u8; 32],
        sender: [u8; 32],
        refund_address: [u8; 32],
        max_fee: u64,
        init_auction_fee: u64,
        redeemer_message: [u8; 512],
        refund_recipient: [u8; 32],
        vaa_sequence: u64,
        vaa_timestamp: u32,
        vaa_nonce: u32,
        vaa_emitter_chain: u16,
        vaa_consistency_level: u8,
        vaa_emitter_address: [u8; 32],
    ) -> Self {
        Self {
            amount_in,
            min_amount_out,
            deadline,
            target_chain,
            redeemer_message_length,
            redeemer,
            sender,
            refund_address,
            max_fee,
            init_auction_fee,
            redeemer_message,
            refund_recipient,
            vaa_sequence,
            vaa_timestamp,
            vaa_nonce,
            vaa_emitter_chain,
            vaa_consistency_level,
            vaa_emitter_address,
            _padding: [0_u8; 5],
        }
    }

    pub const SEED_PREFIX: &'static [u8] = b"fast_market_order";

    pub fn to_vec(&self) -> Vec<u8> {
        let payload_slice = bytemuck::bytes_of(self);
        let mut payload = Vec::with_capacity(payload_slice.len());
        payload.extend_from_slice(payload_slice);
        payload
    }

    pub fn payload(&self) -> Vec<u8> {
        let mut payload = vec![];
        payload.push(11_u8);
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
            payload
                .extend_from_slice(&self.redeemer_message[..self.redeemer_message_length as usize]);
        }
        payload
    }

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
}
