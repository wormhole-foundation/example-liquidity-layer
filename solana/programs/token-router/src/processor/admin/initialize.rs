use crate::{error::TokenRouterError, state::Custodian};
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
    /// Sender Config account, which saves program data useful for other
    /// instructions, specifically for outbound transfers. Also saves the payer
    /// of the [`initialize`](crate::initialize) instruction as the program's
    /// owner.
    custodian: Account<'info, Custodian>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = owner_assistant.key() != Pubkey::default() @ TokenRouterError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

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

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    ctx.accounts.custodian.set_inner(Custodian {
        bump: ctx.bumps["custodian"],
        custody_token_bump: ctx.bumps["custody_token"],
        paused: false,
        paused_set_by: owner,
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
    });

    // Done.
    Ok(())
}
