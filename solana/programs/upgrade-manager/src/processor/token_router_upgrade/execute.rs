use anchor_lang::prelude::*;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

use crate::{state::UpgradeReceipt, UPGRADE_AUTHORITY_SIGNER_SEEDS};

#[derive(Accounts)]
pub struct ExecuteTokenRouterUpgrade<'info> {
    /// Owner of this program. Must match the upgrade authority in this program data.
    #[account(mut)]
    owner: Signer<'info>,

    /// CHECK: Upgrade authority for the liquidity layer program (either Token Router or Matching
    /// Engine). This address must equal the liquidity layer program data's upgrade authority.
    #[account(address = common::constants::UPGRADE_MANAGER_AUTHORITY)]
    upgrade_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + UpgradeReceipt::INIT_SPACE,
        seeds = [
            UpgradeReceipt::SEED_PREFIX,
            token_router_program.key().as_ref(),
        ],
        bump,
    )]
    upgrade_receipt: Account<'info, UpgradeReceipt>,

    /// Deployed implementation of liquidity layer.
    ///
    /// CHECK: This address must be the deployed implementation pubkey.
    #[account(mut)]
    token_router_buffer: AccountInfo<'info>,

    /// CHECK: Must be BPF Loader Upgradeable's PDA of liquidity layer program's program data.
    #[account(
        mut,
        seeds = [token_router_program.key().as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    token_router_program_data: Account<'info, ProgramData>,

    #[account(mut)]
    token_router_custodian: Account<'info, token_router::state::Custodian>,

    /// CHECK: Must be Token Router program . We cannot use the Program<'info, ..> definition here
    /// because we cannot set this account to be mutable in that case.
    #[account(
        mut,
        address = common::constants::TOKEN_ROUTER_PROGRAM_ID,
    )]
    token_router_program: AccountInfo<'info>,

    bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,
    system_program: Program<'info, System>,

    /// CHECK: Must be rent sysvar pubkey.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,

    /// CHECK: Must be clock sysvar pubkey.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,
}

pub fn execute_token_router_upgrade(ctx: Context<ExecuteTokenRouterUpgrade>) -> Result<()> {
    token_router::cpi::authorize_upgrade(CpiContext::new_with_signer(
        ctx.accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::AuthorizeUpgrade {
            owner: ctx.accounts.owner.to_account_info(),
            custodian: ctx.accounts.token_router_custodian.to_account_info(),
            upgrade_manager_authority: ctx.accounts.upgrade_authority.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    ctx.accounts.upgrade_receipt.set_inner(UpgradeReceipt {
        bump: ctx.bumps.upgrade_receipt,
        owner: *ctx.accounts.owner.key,
        buffer: *ctx.accounts.token_router_buffer.key,
        slot: Clock::get().unwrap().slot,
    });

    // First set the buffer's authority to the upgrade authority.
    bpf_loader_upgradeable::set_buffer_authority_checked(CpiContext::new_with_signer(
        ctx.accounts
            .bpf_loader_upgradeable_program
            .to_account_info(),
        bpf_loader_upgradeable::SetBufferAuthorityChecked {
            buffer: ctx.accounts.token_router_buffer.to_account_info(),
            current_authority: ctx.accounts.owner.to_account_info(),
            new_authority: ctx.accounts.upgrade_authority.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    bpf_loader_upgradeable::upgrade(CpiContext::new_with_signer(
        ctx.accounts
            .bpf_loader_upgradeable_program
            .to_account_info(),
        bpf_loader_upgradeable::Upgrade {
            program: ctx.accounts.token_router_program.to_account_info(),
            program_data: ctx.accounts.token_router_program_data.to_account_info(),
            buffer: ctx.accounts.token_router_buffer.to_account_info(),
            authority: ctx.accounts.upgrade_authority.to_account_info(),
            spill: ctx.accounts.owner.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            clock: ctx.accounts.clock.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))
}
