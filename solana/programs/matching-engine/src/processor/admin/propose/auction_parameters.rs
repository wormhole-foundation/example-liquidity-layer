use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{AuctionParameters, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ProposeAuctionParameters<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: Admin<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [
            Proposal::SEED_PREFIX,
            &admin.custodian.next_proposal_id.to_be_bytes()
        ],
        bump,
    )]
    proposal: Account<'info, Proposal>,

    system_program: Program<'info, System>,

    epoch_schedule: Sysvar<'info, EpochSchedule>,
}

pub fn propose_auction_parameters(
    ctx: Context<ProposeAuctionParameters>,
    parameters: AuctionParameters,
) -> Result<()> {
    crate::utils::auction::require_valid_parameters(&parameters)?;

    let id = ctx
        .accounts
        .admin
        .custodian
        .auction_config_id
        .checked_add(1)
        .ok_or(MatchingEngineError::U32Overflow)?;
    let action = ProposalAction::UpdateAuctionParameters { id, parameters };

    super::propose(
        super::Propose {
            custodian: &ctx.accounts.admin.custodian,
            proposal: &mut ctx.accounts.proposal,
            by: &ctx.accounts.admin.owner_or_assistant,
            epoch_schedule: &ctx.accounts.epoch_schedule,
        },
        action,
        ctx.bumps.proposal,
    )?;

    // Emit event reflecting the proposal.
    emit!(crate::events::Proposed { action });

    // Done.
    Ok(())
}
