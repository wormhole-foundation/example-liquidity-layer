use crate::state::FastFillInfo;
use anchor_lang::prelude::*;

#[event]
pub struct FilledLocalFastOrder {
    pub fast_fill: Pubkey,
    pub info: FastFillInfo,
    pub redeemer_message: Vec<u8>,
}
