use anchor_lang::prelude::*;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

#[derive(Accounts)]
pub struct UpgradeMatchingEngine<'info> {
    /// Owner of this program. Must match the upgrade authority in this program data.
    #[account(
        mut,
        address = program_data.upgrade_authority_address.unwrap_or_default()
    )]
    owner: Signer<'info>,

    /// Program data for this program. Its upgrade authority must match the owner.
    #[account(
        mut,
        seeds = [crate::id().as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    program_data: Account<'info, ProgramData>,

    /// CHECK: Upgrade authority for the liquidity layer program (either Token Router or Matching
    /// Engine). This address must equal the liquidity layer program data's upgrade authority.
    #[account(address = common::constants::UPGRADE_MANAGER_AUTHORITY)]
    upgrade_authority: AccountInfo<'info>,

    /// Deployed implementation of liquidity layer.
    ///
    /// CHECK: This address must be the deployed implementation pubkey.
    #[account(mut)]
    matching_engine_buffer: AccountInfo<'info>,

    /// CHECK: Must be BPF Loader Upgradeable's PDA of liquidity layer program's program data.
    #[account(
        mut,
        seeds = [matching_engine_program.key().as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    matching_engine_program_data: Account<'info, ProgramData>,

    /// CHECK: Must be Token Router program . We cannot use the Program<'info, ..> definition here
    /// because we cannot set this account to be mutable in that case.
    #[account(
        mut,
        address = common::constants::MATCHING_ENGINE_PROGRAM_ID,
    )]
    matching_engine_program: AccountInfo<'info>,

    bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,

    /// CHECK: Must be rent sysvar pubkey.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,

    /// CHECK: Must be clock sysvar pubkey.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,
}

pub fn upgrade_matching_engine(ctx: Context<UpgradeMatchingEngine>) -> Result<()> {
    // First set the buffer's authority to the upgrade authority.
    bpf_loader_upgradeable::set_buffer_authority_checked(CpiContext::new_with_signer(
        ctx.accounts
            .bpf_loader_upgradeable_program
            .to_account_info(),
        bpf_loader_upgradeable::SetBufferAuthorityChecked {
            buffer: ctx.accounts.matching_engine_buffer.to_account_info(),
            current_authority: ctx.accounts.owner.to_account_info(),
            new_authority: ctx.accounts.upgrade_authority.to_account_info(),
        },
        &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    bpf_loader_upgradeable::upgrade(CpiContext::new_with_signer(
        ctx.accounts
            .bpf_loader_upgradeable_program
            .to_account_info(),
        bpf_loader_upgradeable::Upgrade {
            program: ctx.accounts.matching_engine_program.to_account_info(),
            program_data: ctx.accounts.matching_engine_program_data.to_account_info(),
            buffer: ctx.accounts.matching_engine_buffer.to_account_info(),
            authority: ctx.accounts.upgrade_authority.to_account_info(),
            spill: ctx.accounts.owner.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            clock: ctx.accounts.clock.to_account_info(),
        },
        &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))
}
