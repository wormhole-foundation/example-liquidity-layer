use crate::state::FastFillSeeds;
use anchor_lang::prelude::*;

#[event]
pub struct FastFillSequenceReserved {
    pub fast_vaa_hash: [u8; 32],
    pub fast_fill: FastFillSeeds,
}
