use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
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
    /// Sender Config account, which saves program data useful for other
    /// instructions, specifically for outbound transfers. Also saves the payer
    /// of the [`initialize`](crate::initialize) instruction as the program's
    /// owner.
    custodian: Account<'info, Custodian>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = {
            owner_assistant.key() != Pubkey::default()
        } @ TokenRouterError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump,
        token::mint = mint,
        token::authority = custodian
    )]
    custody_token: Account<'info, token::TokenAccount>,

    #[account(address = common::constants::usdc::id() @ TokenRouterError::NotUsdc)]
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
        } @ TokenRouterError::ImmutableProgram
    )]
    program_data: Account<'info, ProgramData>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let owner = ctx.accounts.owner.key();

    // We need to check that the upgrade authority is the owner passed into the account context.
    #[cfg(not(feature = "integration-test"))]
    {
        require_keys_eq!(
            owner,
            ctx.accounts.program_data.upgrade_authority_address.unwrap(),
            TokenRouterError::OwnerOnly
        );
    }

    ctx.accounts.custodian.set_inner(Custodian {
        paused: false,
        paused_set_by: owner,
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
    });

    // Done.
    Ok(())
}
