use crate::{composite::*, state::Proposal};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseProposal<'info> {
    admin: OwnerOnly<'info>,

    /// CHECK: This account must equal proposal.by pubkey.
    #[account(
        mut,
        address = proposal.by
    )]
    proposed_by: AccountInfo<'info>,

    #[account(
        mut,
        close = proposed_by,
        seeds = [
            Proposal::SEED_PREFIX,
            &proposal.id.to_be_bytes(),
        ],
        bump = proposal.bump,
        constraint = proposal.slot_enacted_at.is_none() @ ErrorCode::InstructionMissing, // TODO: add err ProposalAlreadyEnacted
    )]
    proposal: Account<'info, Proposal>,
}

pub fn close_proposal(_ctx: Context<CloseProposal>) -> Result<()> {
    Ok(())
}
