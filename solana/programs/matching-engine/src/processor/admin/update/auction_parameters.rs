use crate::{
    error::MatchingEngineError,
    state::custodian::*,
    state::{AuctionConfig, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateAuctionParameters<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: OwnerMutCustodian<'info>,

    #[account(
        mut,
        seeds = [
            Proposal::SEED_PREFIX,
            proposal.id.to_be_bytes().as_ref(),
        ],
        bump = proposal.bump,
        constraint = {
            require!(
                proposal.owner == admin.owner.key(),
                MatchingEngineError::OwnerOnly
            );
            require!(
                proposal.slot_enacted_at.is_none(),
                MatchingEngineError::ProposalAlreadyEnacted
            );

            require!(
                Clock::get().unwrap().slot >= proposal.slot_enact_delay,
                MatchingEngineError::ProposalDelayNotExpired
            );

            match &proposal.action {
                ProposalAction::UpdateAuctionParameters { id, .. } => {
                    require_eq!(
                        *id,
                        admin.custodian.auction_config_id + 1,
                        MatchingEngineError::AuctionConfigMismatch
                    );
                },
                _ => return err!(ErrorCode::InstructionMissing),
            };

            true
        }
    )]
    proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = payer,
        space = 8 + AuctionConfig::INIT_SPACE,
        seeds = [
            AuctionConfig::SEED_PREFIX,
            (admin.custodian.auction_config_id + 1).to_be_bytes().as_ref()
        ],
        bump,
    )]
    auction_config: Account<'info, AuctionConfig>,

    system_program: Program<'info, System>,
}

pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
    if let ProposalAction::UpdateAuctionParameters { id, parameters } = ctx.accounts.proposal.action
    {
        ctx.accounts
            .auction_config
            .set_inner(AuctionConfig { id, parameters });
    } else {
        unreachable!();
    }

    // Update the auction config ID.
    ctx.accounts.admin.custodian.auction_config_id += 1;

    // Set the slot enacted at so it cannot be replayed.
    ctx.accounts.proposal.slot_enacted_at = Some(Clock::get().unwrap().slot);

    // Uptick the proposal ID so that someone can create a new proposal again.
    ctx.accounts.admin.custodian.next_proposal_id += 1;

    // Done.
    Ok(())
}
