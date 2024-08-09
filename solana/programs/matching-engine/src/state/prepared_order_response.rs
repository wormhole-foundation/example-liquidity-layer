use anchor_lang::prelude::*;

use super::{Auction, EndpointInfo};

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

    /// This is a necessary security check. This will prevent a relayer from
    /// starting an auction with the fast transfer VAA, even though the slow
    /// relayer already delivered the slow VAA. Not setting this could lead to
    /// trapped funds (which would require an upgrade to fix).
    pub(crate) fn new_auction_placeholder(&self, bump: u8) -> Auction {
        Auction {
            bump,
            vaa_hash: self.seeds.fast_vaa_hash,
            vaa_timestamp: self.fast_vaa_timestamp,
            target_protocol: self.to_endpoint.protocol,
            status: Default::default(),
            prepared_by: self.prepared_by,
            info: Default::default(),
        }
    }

    pub(crate) fn compute_size(redeemer_message_len: usize) -> usize {
        const FIXED: usize = 8 // DISCRIMINATOR
            + PreparedOrderResponseSeeds::INIT_SPACE
            + PreparedOrderResponseInfo::INIT_SPACE
            + EndpointInfo::INIT_SPACE
            + 4 // redeemer_message_len
        ;

        redeemer_message_len.saturating_add(FIXED)
    }
}
