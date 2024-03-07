use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, Custodian, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateAuctionParameters<'info> {
    #[account(mut)]
    owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        has_one = owner @ MatchingEngineError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    #[account(
        mut,
        seeds = [
            Proposal::SEED_PREFIX,
            proposal.id.to_be_bytes().as_ref(),
        ],
        bump = proposal.bump,
        has_one = owner,
        constraint = {
            require!(
                proposal.slot_enacted_at.is_none(),
                MatchingEngineError::ProposalAlreadyEnacted
            );

            require!(
                Clock::get()?.slot >= proposal.slot_enact_delay,
                MatchingEngineError::ProposalDelayNotExpired
            );

            match &proposal.action {
                ProposalAction::UpdateAuctionParameters { id, .. } => {
                    require_eq!(
                        *id,
                        custodian.auction_config_id + 1,
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
        payer = owner,
        space = 8 + AuctionConfig::INIT_SPACE,
        seeds = [
            AuctionConfig::SEED_PREFIX,
            (custodian.auction_config_id + 1).to_be_bytes().as_ref()
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
    ctx.accounts.custodian.auction_config_id += 1;

    // Set the slot enacted at so it cannot be replayed.
    ctx.accounts.proposal.slot_enacted_at = Some(Clock::get().map(|clock| clock.slot)?);

    // Done.
    Ok(())
}
