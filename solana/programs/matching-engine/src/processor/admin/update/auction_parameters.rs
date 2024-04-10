use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{AuctionConfig, AuctionParameters, Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateAuctionParameters<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: OwnerOnlyMut<'info>,

    #[account(
        mut,
        seeds = [
            Proposal::SEED_PREFIX,
            &proposal.id.to_be_bytes(),
        ],
        bump = proposal.bump,
        constraint = {
            require_keys_eq!(
                proposal.owner, admin.owner.key()
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
                        // NOTE: This value is checked in `propose_auction_parameters`.
                        admin.custodian.auction_config_id.saturating_add(1),
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
            // NOTE: This value is checked in `propose_auction_parameters`.
            admin.custodian.auction_config_id.saturating_add(1).to_be_bytes().as_ref()
        ],
        bump,
    )]
    auction_config: Account<'info, AuctionConfig>,

    system_program: Program<'info, System>,
}

pub fn update_auction_parameters(ctx: Context<UpdateAuctionParameters>) -> Result<()> {
    let action = ctx.accounts.proposal.action;

    // Emit event to reflect enacting the proposal.
    emit!(crate::events::Enacted { action });

    match action {
        ProposalAction::UpdateAuctionParameters { id, parameters } => {
            handle_update_auction_parameters(ctx, id, parameters)
        }
        _ => err!(MatchingEngineError::InvalidProposal),
    }
}

fn handle_update_auction_parameters(
    ctx: Context<UpdateAuctionParameters>,
    id: u32,
    parameters: AuctionParameters,
) -> Result<()> {
    ctx.accounts
        .auction_config
        .set_inner(AuctionConfig { id, parameters });

    // Update the auction config ID.
    ctx.accounts.admin.custodian.auction_config_id = id;

    // Set the slot enacted at so it cannot be replayed.
    ctx.accounts.proposal.slot_enacted_at = Some(Clock::get().unwrap().slot);

    // Uptick the proposal ID so that someone can create a new proposal again.
    //
    // NOTE: Overflow check is done in propose instructions.
    let next_proposal_id = ctx
        .accounts
        .admin
        .custodian
        .next_proposal_id
        .saturating_add(1);
    ctx.accounts.admin.custodian.next_proposal_id = next_proposal_id;

    // Done.
    Ok(())
}
