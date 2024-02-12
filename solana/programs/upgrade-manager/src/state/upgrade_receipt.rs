use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct UpgradeReceipt {
    pub bump: u8,

    pub owner: Pubkey,
    pub buffer: Pubkey,
    pub slot: u64,
}

impl UpgradeReceipt {
    pub const SEED_PREFIX: &'static [u8] = b"receipt";
}
