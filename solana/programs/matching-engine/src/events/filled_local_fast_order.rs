use crate::state::{FastFillInfo, FastFillSeeds};
use anchor_lang::prelude::*;

#[event]
pub struct FilledLocalFastOrder {
    pub seeds: FastFillSeeds,
    pub info: FastFillInfo,
    pub auction: Option<Pubkey>,
}
