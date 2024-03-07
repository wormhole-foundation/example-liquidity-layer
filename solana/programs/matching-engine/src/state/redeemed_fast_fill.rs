use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct RedeemedFastFill {
    pub bump: u8,
    pub vaa_hash: [u8; 32],
    pub sequence: u64,
}

impl RedeemedFastFill {
    pub const SEED_PREFIX: &'static [u8] = b"redeemed";
}
