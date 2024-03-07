use anchor_lang::prelude::*;

use crate::AuctionParameters;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum ProposalAction {
    None,
    UpdateAuctionParameters {
        id: u32,
        parameters: AuctionParameters,
    },
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Proposal {
    pub id: u64,
    pub bump: u8,

    pub action: ProposalAction,
    pub by: Pubkey,
    pub owner: Pubkey,

    pub slot_proposed_at: u64,
    pub slot_enact_delay: u64,
    pub slot_enacted_at: Option<u64>,
}

impl Proposal {
    pub const SEED_PREFIX: &'static [u8] = b"proposal";
}
