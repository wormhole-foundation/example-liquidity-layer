use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, Custodian},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::constants::FEE_PRECISION_MAX;
use solana_program::bpf_loader_upgradeable;

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
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump,
        token::mint = mint,
        token::authority = custodian
    )]
    custody_token: Account<'info, token::TokenAccount>,

    #[account(address = common::constants::usdc::id() @ MatchingEngineError::NotUsdc)]
    mint: Account<'info, token::Mint>,

    /// We use the program data to make sure this owner is the upgrade authority (the true owner,
    /// who deployed this program).
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::id(),
        constraint = program_data.upgrade_authority_address.is_some() @ MatchingEngineError::ImmutableProgram
    )]
    program_data: Account<'info, ProgramData>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

#[access_control(check_constraints(&ctx, &auction_config))]
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

fn check_constraints(ctx: &Context<Initialize>, config: &AuctionConfig) -> Result<()> {
    // We need to check that the upgrade authority is the owner passed into the account context.
    #[cfg(not(feature = "integration-test"))]
    {
        {
            require_keys_eq!(
                ctx.accounts.owner.key(),
                ctx.accounts.program_data.upgrade_authority_address.unwrap(),
                MatchingEngineError::OwnerOnly
            );
        }
    }

    // This prevents the unused variables warning popping up when this program is built.
    let _ = ctx;

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
