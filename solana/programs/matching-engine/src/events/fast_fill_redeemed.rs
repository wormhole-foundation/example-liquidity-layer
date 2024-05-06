use anchor_lang::prelude::*;

#[event]
pub struct FastFillRedeemed {
    pub prepared_by: Pubkey,
    pub fast_fill: Pubkey,
}
