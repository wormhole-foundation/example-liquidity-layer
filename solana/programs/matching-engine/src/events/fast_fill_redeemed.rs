use anchor_lang::prelude::*;

use crate::state::FastFillSeeds;

#[event]
pub struct FastFillRedeemed {
    pub prepared_by: Pubkey,
    pub fast_fill: FastFillSeeds,
}
