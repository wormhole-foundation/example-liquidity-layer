use anchor_lang::prelude::*;

use super::FastFillSeeds;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ReservedFastFillSequenceSeeds {
    pub fast_vaa_hash: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct ReservedFastFillSequence {
    pub seeds: ReservedFastFillSequenceSeeds,
    pub beneficiary: Pubkey,
    pub fast_fill_seeds: FastFillSeeds,
}

impl ReservedFastFillSequence {
    pub const SEED_PREFIX: &'static [u8] = b"reserved-fast-fill-sequence";
}

impl std::ops::Deref for ReservedFastFillSequence {
    type Target = FastFillSeeds;

    fn deref(&self) -> &Self::Target {
        &self.fast_fill_seeds
    }
}
