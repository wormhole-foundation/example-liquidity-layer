use std::ops::Deref;

use crate::{
    error::UpgradeManagerError,
    state::{UpgradeReceipt, UpgradeStatus},
};
use anchor_lang::prelude::*;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

#[derive(Accounts)]
pub struct ProgramOwnerOnly<'info> {
    /// Owner of this program. Must match the upgrade authority in this program data.
    pub owner: Signer<'info>,

    /// CHECK: Upgrade authority for the liquidity layer program (either Token Router or Matching
    /// Engine). This address must equal the liquidity layer program data's upgrade authority.
    #[account(address = common::constants::UPGRADE_MANAGER_AUTHORITY)]
    pub upgrade_authority: AccountInfo<'info>,
}

impl<'info> Deref for ProgramOwnerOnly<'info> {
    type Target = Signer<'info>;

    fn deref(&self) -> &Self::Target {
        &self.owner
    }
}

impl<'info> AsRef<AccountInfo<'info>> for ProgramOwnerOnly<'info> {
    fn as_ref(&self) -> &AccountInfo<'info> {
        &self.owner
    }
}

#[derive(Accounts)]
pub struct ExecuteUpgrade<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub admin: ProgramOwnerOnly<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + UpgradeReceipt::INIT_SPACE,
        seeds = [
            UpgradeReceipt::SEED_PREFIX,
            program.key().as_ref(),
        ],
        bump,
    )]
    pub receipt: Account<'info, UpgradeReceipt>,

    /// Deployed implementation of liquidity layer.
    ///
    /// CHECK: This address must be the deployed implementation pubkey.
    #[account(mut)]
    pub buffer: AccountInfo<'info>,

    /// CHECK: Must be BPF Loader Upgradeable's PDA of liquidity layer program's program data.
    #[account(
        mut,
        seeds = [program.key().as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    pub program_data: Account<'info, ProgramData>,

    /// CHECK: Must be Token Router program . We cannot use the Program<'info, ..> definition here
    /// because we cannot set this account to be mutable in that case.
    #[account(mut)]
    pub program: AccountInfo<'info>,

    pub bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,
    pub system_program: Program<'info, System>,

    pub sysvars: RequiredSysvars<'info>,
}

#[derive(Accounts)]
pub struct CommitUpgrade<'info> {
    pub admin: ProgramOwnerOnly<'info>,

    /// CHECK: This account will receive lamports from upgrade receipt.
    #[account(mut)]
    recipient: AccountInfo<'info>,

    #[account(
        mut,
        close = recipient,
        seeds = [
            UpgradeReceipt::SEED_PREFIX,
            program.key().as_ref(),
        ],
        bump = receipt.bump,
        constraint = {
            match receipt.status {
                UpgradeStatus::Uncommitted { buffer: _, slot } => {
                    require_eq!(
                        slot,
                        program_data.slot,
                        UpgradeManagerError::ProgramDataMismatch,
                    );

                    Ok(())
                },
                _ => err!(UpgradeManagerError::NotUpgraded),
            }?;

            true
        }
    )]
    receipt: Account<'info, UpgradeReceipt>,

    /// CHECK: Must be executable.
    #[account(executable)]
    pub program: AccountInfo<'info>,

    #[account(
        seeds = [program.key().as_ref()],
        bump = receipt.program_data_bump,
        seeds::program = bpf_loader_upgradeable::id(),
    )]
    program_data: Account<'info, ProgramData>,
}

#[derive(Accounts)]
pub struct RequiredSysvars<'info> {
    /// Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    ///
    /// CHECK: Must equal clock ID.
    #[account(address = solana_program::sysvar::clock::id())]
    pub clock: AccountInfo<'info>,

    /// Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    ///
    /// CHECK: Must equal rent ID.
    #[account(address = solana_program::sysvar::rent::id())]
    pub rent: AccountInfo<'info>,
}
