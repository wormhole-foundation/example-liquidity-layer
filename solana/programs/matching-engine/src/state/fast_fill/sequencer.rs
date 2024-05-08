use anchor_lang::prelude::*;

#[derive(
    Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default, PartialEq, Eq,
)]
pub struct FastFillSequencerSeeds {
    pub source_chain: u16,
    pub sender: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct FastFillSequencer {
    pub seeds: FastFillSequencerSeeds,
    pub next_sequence: u64,
}

impl FastFillSequencer {
    pub const SEED_PREFIX: &'static [u8] = b"fast-fill-sequencer";
}
