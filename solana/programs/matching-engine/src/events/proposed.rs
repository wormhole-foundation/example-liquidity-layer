use crate::state::ProposalAction;
use anchor_lang::prelude::*;

#[event]
pub struct Proposed {
    pub action: ProposalAction,
}
