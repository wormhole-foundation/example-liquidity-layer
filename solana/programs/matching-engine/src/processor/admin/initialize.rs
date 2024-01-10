use crate::constants::FEE_PRECISION_MAX;
use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, Custodian},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Owner of the program, who presumably deployed this program.
    #[account(mut)]
    owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Custodian::INIT_SPACE,
        seeds = [Custodian::SEED_PREFIX],
        bump,
    )]
    /// Custodian account, which saves program data useful for other
    /// instructions.
    custodian: Account<'info, Custodian>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = owner_assistant.key() != Pubkey::default() @ MatchingEngineError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = fee_recipient.key() != Pubkey::default() @ MatchingEngineError::FeeRecipientZeroPubkey
    )]
    fee_recipient: AccountInfo<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [crate::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump,
        token::mint = mint,
        token::authority = custodian
    )]
    custody_token: Account<'info, token::TokenAccount>,

    #[account(address = common::constants::usdc::id())]
    mint: Account<'info, token::Mint>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

#[access_control(check_constraints(&auction_config))]
pub fn initialize(ctx: Context<Initialize>, auction_config: AuctionConfig) -> Result<()> {
    let owner: Pubkey = ctx.accounts.owner.key();
    ctx.accounts.custodian.set_inner(Custodian {
        bump: ctx.bumps["custodian"],
        custody_token_bump: ctx.bumps["custody_token"],
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_recipient: ctx.accounts.fee_recipient.key(),
        auction_config,
    });

    // Done.
    Ok(())
}

fn check_constraints(config: &AuctionConfig) -> Result<()> {
    require!(
        config.auction_duration > 0,
        MatchingEngineError::InvalidAuctionDuration
    );
    require!(
        config.auction_grace_period > config.auction_duration,
        MatchingEngineError::InvalidAuctionGracePeriod
    );
    require!(
        config.user_penalty_reward_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::UserPenaltyTooLarge
    );
    require!(
        config.initial_penalty_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::InitialPenaltyTooLarge
    );

    // Done.
    Ok(())
}
