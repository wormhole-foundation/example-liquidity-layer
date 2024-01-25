use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, Custodian},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use solana_program::bpf_loader_upgradeable;

// Because this is used as the args for initialize, we'll make it public here.
pub use crate::state::AuctionParameters;

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

    #[account(
        init,
        payer = owner,
        space = 8 + AuctionConfig::INIT_SPACE,
        seeds = [
            AuctionConfig::SEED_PREFIX,
            u32::default().to_be_bytes().as_ref()
        ],
        bump,
    )]
    auction_config: Account<'info, AuctionConfig>,

    /// CHECK: This account must not be the zero pubkey.
    /// TODO: do we prevent the owner from being the owner assistant?
    #[account(
        owner = Pubkey::default(),
        constraint = {
            owner_assistant.key() != Pubkey::default()
        } @ MatchingEngineError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = (
            fee_recipient.key() != Pubkey::default()
        ) @ MatchingEngineError::FeeRecipientZeroPubkey
    )]
    fee_recipient: AccountInfo<'info>,

    #[account(
        associated_token::mint = mint,
        associated_token::authority = fee_recipient,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = custodian,
        address = crate::custody_token::id() @ MatchingEngineError::InvalidCustodyToken,
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
        constraint = {
            program_data.upgrade_authority_address.is_some()
        } @ MatchingEngineError::ImmutableProgram
    )]
    program_data: Account<'info, ProgramData>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

#[access_control(check_constraints(&ctx, &auction_params))]
pub fn initialize(ctx: Context<Initialize>, auction_params: AuctionParameters) -> Result<()> {
    let owner: Pubkey = ctx.accounts.owner.key();
    let auction_config_id = 0;
    ctx.accounts.custodian.set_inner(Custodian {
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_recipient_token: ctx.accounts.fee_recipient_token.key(),
        auction_config_id,
        next_proposal_id: Default::default(),
    });

    ctx.accounts.auction_config.set_inner(AuctionConfig {
        id: auction_config_id,
        parameters: auction_params,
    });

    // Done.
    Ok(())
}

fn check_constraints(ctx: &Context<Initialize>, params: &AuctionParameters) -> Result<()> {
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

    crate::utils::math::require_valid_auction_parameters(params)?;

    // Done.
    Ok(())
}
