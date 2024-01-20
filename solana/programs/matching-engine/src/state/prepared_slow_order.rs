use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct PreparedSlowOrder {
    pub bump: u8,
    pub prepared_by: Pubkey,
    pub fast_vaa_hash: [u8; 32],

    pub source_chain: u16,
    pub base_fee: u64,
}

impl PreparedSlowOrder {
    pub const SEED_PREFIX: &'static [u8] = b"prepared";
}
