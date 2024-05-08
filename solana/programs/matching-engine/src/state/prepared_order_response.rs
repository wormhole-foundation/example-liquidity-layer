use anchor_lang::prelude::*;

use super::EndpointInfo;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedOrderResponseSeeds {
    pub fast_vaa_hash: [u8; 32],
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedOrderResponseInfo {
    pub prepared_by: Pubkey,

    pub fast_vaa_timestamp: u32,
    pub source_chain: u16,
    pub base_fee: u64,
    pub init_auction_fee: u64,
    pub sender: [u8; 32],
    pub redeemer: [u8; 32],
    pub amount_in: u64,
}

#[account]
#[derive(Debug)]
pub struct PreparedOrderResponse {
    pub seeds: PreparedOrderResponseSeeds,
    pub info: PreparedOrderResponseInfo,
    pub to_endpoint: EndpointInfo,
    pub redeemer_message: Vec<u8>,
}

impl std::ops::Deref for PreparedOrderResponse {
    type Target = PreparedOrderResponseInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}

impl PreparedOrderResponse {
    pub const SEED_PREFIX: &'static [u8] = b"order-response";

    pub fn compute_size(redeemer_message_len: usize) -> usize {
        const FIXED: usize = 8 // DISCRIMINATOR
            + PreparedOrderResponseSeeds::INIT_SPACE
            + PreparedOrderResponseInfo::INIT_SPACE
            + EndpointInfo::INIT_SPACE
            + 4 // redeemer_message length
            ;

        redeemer_message_len.saturating_add(FIXED)
    }
}
