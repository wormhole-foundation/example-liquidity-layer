use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct PreparedAuctionSettlement {
    pub bump: u8,
    pub fast_vaa_hash: [u8; 32],

    pub prepared_by: Pubkey,

    pub source_chain: u16,
    pub base_fee: u64,
}

impl PreparedAuctionSettlement {
    pub const SEED_PREFIX: &'static [u8] = b"auction-settlement";
}
