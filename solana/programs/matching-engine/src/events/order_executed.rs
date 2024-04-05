use crate::state::MessageProtocol;
use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct OrderExecuted {
    pub auction: Pubkey,
    pub vaa: Pubkey,
    pub target_protocol: MessageProtocol,
}
