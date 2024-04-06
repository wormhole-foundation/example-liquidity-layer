use crate::state::ProposalAction;
use anchor_lang::prelude::*;

#[event]
pub struct Enacted {
    pub action: ProposalAction,
}
