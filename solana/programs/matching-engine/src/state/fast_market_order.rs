use anchor_lang::prelude::*;

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
}

impl FastMarketOrder {
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
            payload.extend_from_slice(&self.redeemer_message[..self.redeemer_message_length as usize]);
        }
        payload
    }
}

