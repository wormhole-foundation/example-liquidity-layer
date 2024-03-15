use crate::{
    processor::shared_contexts::*,
    state::{AuctionParameters, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ProposeAuctionParameters<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: AdminMutCustodian<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [
            Proposal::SEED_PREFIX,
            admin.custodian.next_proposal_id.to_be_bytes().as_ref()
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

    let id = ctx.accounts.admin.custodian.auction_config_id + 1;
    super::propose(
        super::Propose {
            custodian: &mut ctx.accounts.admin.custodian,
            proposal: &mut ctx.accounts.proposal,
            by: &ctx.accounts.admin.owner_or_assistant,
            epoch_schedule: &ctx.accounts.epoch_schedule,
        },
        ProposalAction::UpdateAuctionParameters { id, parameters },
        ctx.bumps.proposal,
    )
}
