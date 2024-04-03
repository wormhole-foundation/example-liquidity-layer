use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct OrderExecuted {
    pub auction: Pubkey,
    pub vaa: Pubkey,
}
