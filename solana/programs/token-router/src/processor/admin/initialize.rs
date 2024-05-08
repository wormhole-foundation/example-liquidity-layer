use crate::{composite::*, error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

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
    owner_assistant: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = custodian,
        address = crate::CCTP_MINT_RECIPIENT
    )]
    cctp_mint_recipient: Box<Account<'info, token::TokenAccount>>,

    mint: Usdc<'info>,

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

    /// CHECK: This program PDA will be the upgrade authority for the Token Router program.
    #[account(address = common::UPGRADE_MANAGER_AUTHORITY)]
    upgrade_manager_authority: UncheckedAccount<'info>,

    /// CHECK: This program must exist.
    #[account(
        executable,
        address = common::UPGRADE_MANAGER_PROGRAM_ID,
    )]
    upgrade_manager_program: UncheckedAccount<'info>,

    bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let owner = ctx.accounts.owner.key();

    // We need to check that the upgrade authority is the owner passed into the account context.
    #[cfg(not(feature = "integration-test"))]
    {
        require_keys_eq!(
            ctx.accounts.owner.key(),
            ctx.accounts.program_data.upgrade_authority_address.unwrap(),
            TokenRouterError::OwnerOnly
        );

        bpf_loader_upgradeable::set_upgrade_authority(
            CpiContext::new(
                ctx.accounts
                    .bpf_loader_upgradeable_program
                    .to_account_info(),
                bpf_loader_upgradeable::SetUpgradeAuthority {
                    program_data: ctx.accounts.program_data.to_account_info(),
                    current_authority: ctx.accounts.owner.to_account_info(),
                    new_authority: ctx
                        .accounts
                        .upgrade_manager_authority
                        .to_account_info()
                        .into(),
                },
            ),
            &crate::id(),
        )?;
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
