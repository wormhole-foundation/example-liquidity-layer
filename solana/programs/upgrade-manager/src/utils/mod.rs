use crate::{
    composite::*,
    error::UpgradeManagerError,
    state::{UpgradeReceipt, UpgradeStatus},
};
use anchor_lang::prelude::*;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable;

pub trait AuthorizeUpgrade<'info> {
    fn execute_upgrade_composite_mut(&mut self) -> &mut ExecuteUpgrade<'info>;

    fn authorize_upgrade(&self) -> Result<()>;
}

pub fn execute_upgrade_composite<'info, A>(accounts: &mut A) -> &ExecuteUpgrade<'info>
where
    A: AuthorizeUpgrade<'info>,
{
    accounts.execute_upgrade_composite_mut()
}

pub fn execute_upgrade<'info, A>(accounts: &mut A, bumps: &ExecuteUpgradeBumps) -> Result<()>
where
    A: AuthorizeUpgrade<'info>,
{
    match execute_upgrade_composite(accounts).receipt.status {
        UpgradeStatus::None => handle_new_upgrade(accounts, bumps),
        UpgradeStatus::Uncommitted { .. } => handle_upgrade_with_status(accounts, bumps),
    }
}

fn handle_new_upgrade<'info, A>(accounts: &mut A, bumps: &ExecuteUpgradeBumps) -> Result<()>
where
    A: AuthorizeUpgrade<'info>,
{
    accounts.authorize_upgrade()?;
    handle_upgrade(accounts, bumps)
}

fn handle_upgrade_with_status<'info, A>(accounts: &mut A, bumps: &ExecuteUpgradeBumps) -> Result<()>
where
    A: AuthorizeUpgrade<'info>,
{
    let status = {
        let execute_upgrade = execute_upgrade_composite(accounts);

        // Only the owner can upgrade again.
        require_keys_eq!(
            execute_upgrade.admin.owner.key(),
            execute_upgrade.receipt.owner,
            UpgradeManagerError::OwnerMismatch,
        );

        execute_upgrade.receipt.status
    };

    msg!("receipt exists: {:?}", status);
    handle_upgrade(accounts, bumps)
}

fn handle_upgrade<'info, A>(accounts: &mut A, bumps: &ExecuteUpgradeBumps) -> Result<()>
where
    A: AuthorizeUpgrade<'info>,
{
    let ExecuteUpgrade {
        payer,
        admin,
        receipt,
        buffer,
        program_data,
        program,
        bpf_loader_upgradeable_program,
        sysvars,
        ..
    } = accounts.execute_upgrade_composite_mut();

    let ProgramOwnerOnly {
        owner,
        upgrade_authority,
    } = admin;

    receipt.set_inner(UpgradeReceipt {
        bump: bumps.receipt,
        program_data_bump: bumps.program_data,
        owner: owner.key(),
        status: UpgradeStatus::Uncommitted {
            buffer: buffer.key(),
            slot: Clock::get().unwrap().slot,
        },
    });

    // First set the buffer's authority to the upgrade authority.
    bpf_loader_upgradeable::set_buffer_authority_checked(CpiContext::new_with_signer(
        bpf_loader_upgradeable_program.to_account_info(),
        bpf_loader_upgradeable::SetBufferAuthorityChecked {
            buffer: buffer.to_account_info(),
            current_authority: owner.to_account_info(),
            new_authority: upgrade_authority.to_account_info(),
        },
        &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    bpf_loader_upgradeable::upgrade(CpiContext::new_with_signer(
        bpf_loader_upgradeable_program.to_account_info(),
        bpf_loader_upgradeable::Upgrade {
            program: program.to_account_info(),
            program_data: program_data.to_account_info(),
            buffer: buffer.to_account_info(),
            authority: upgrade_authority.to_account_info(),
            spill: payer.to_account_info(),
            rent: sysvars.rent.to_account_info(),
            clock: sysvars.clock.to_account_info(),
        },
        &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))
}
