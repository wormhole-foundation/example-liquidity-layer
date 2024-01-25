use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use common::admin::utils::pending_owner;
use solana_program::bpf_loader_upgradeable;

#[derive(Accounts)]
pub struct ConfirmOwnershipTransferRequest<'info> {
    /// Must be the pending owner of the program set in the [`OwnerConfig`]
    /// account.
    pending_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
        constraint = {
            custodian.pending_owner.is_some()
        } @ MatchingEngineError::NoTransferOwnershipRequest,
        constraint = {
            pending_owner::only_pending_owner_unchecked(&custodian, &pending_owner.key())
        } @ MatchingEngineError::NotPendingOwner,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: BPF Loader Upgradeable program needs to modify this program's data to change the
    /// upgrade authority. We check this PDA address just in case there is another program that this
    /// deployer has deployed.
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    program_data: AccountInfo<'info>,

    /// CHECK: The account's pubkey must be the BPF Loader Upgradeable program's.
    #[account(address = bpf_loader_upgradeable::id())]
    bpf_loader_upgradeable_program: AccountInfo<'info>,
}

pub fn confirm_ownership_transfer_request(
    ctx: Context<ConfirmOwnershipTransferRequest>,
) -> Result<()> {
    pending_owner::accept_ownership_unchecked(&mut ctx.accounts.custodian);

    // Finally set the upgrade authority to the pending owner (the new owner).
    #[cfg(not(feature = "integration-test"))]
    {
        common::admin::cpi::set_upgrade_authority_checked(
            CpiContext::new_with_signer(
                ctx.accounts
                    .bpf_loader_upgradeable_program
                    .to_account_info(),
                common::admin::cpi::SetUpgradeAuthorityChecked {
                    program_data: ctx.accounts.program_data.to_account_info(),
                    current_authority: ctx.accounts.custodian.to_account_info(),
                    new_authority: ctx.accounts.pending_owner.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            crate::ID,
        )?;
    }

    // Done.
    Ok(())
}
