use crate::{
    error::MatchingEngineError,
    state::{AuctionParameters, Custodian, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;
use common::admin::utils::assistant::only_authorized;

#[derive(Accounts)]
pub struct ProposeAuctionParameters<'info> {
    #[account(
        mut,
        constraint = {
            only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        init,
        payer = owner_or_assistant,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [
            Proposal::SEED_PREFIX,
            custodian.next_proposal_id.to_be_bytes().as_ref()
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

    let id = ctx.accounts.custodian.auction_config_id + 1;
    super::propose(
        super::Propose {
            custodian: &mut ctx.accounts.custodian,
            proposal: &mut ctx.accounts.proposal,
            by: &ctx.accounts.owner_or_assistant,
            epoch_schedule: &ctx.accounts.epoch_schedule,
        },
        ProposalAction::UpdateAuctionParameters { id, parameters },
        ctx.bumps.proposal,
    )
}
