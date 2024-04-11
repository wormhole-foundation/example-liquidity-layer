use crate::state::MessageProtocol;
use anchor_lang::prelude::*;

#[event]
#[derive(Debug)]
pub struct OrderExecuted {
    pub auction: Pubkey,
    pub vaa: Pubkey,
    pub source_chain: u16,
    pub target_protocol: MessageProtocol,
    pub penalized: bool,
}
