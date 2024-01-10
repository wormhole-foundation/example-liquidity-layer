use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;
use common::admin::utils::ownable::only_owner;
use solana_program::bpf_loader_upgradeable;

#[derive(Accounts)]
pub struct SubmitOwnershipTransferRequest<'info> {
    owner: Signer<'info>,

    /// Custodian, which can only be modified by the configured owner.
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        constraint = only_owner(&custodian, &owner.key()) @ MatchingEngineError::OwnerOnly,
    )]
    custodian: Account<'info, Custodian>,

    /// New Owner.
    ///
    /// CHECK: Must be neither zero pubkey nor current owner.
    #[account(
        constraint = new_owner.key() != Pubkey::default() @ MatchingEngineError::InvalidNewOwner,
        constraint = new_owner.key() != owner.key() @ MatchingEngineError::AlreadyOwner
    )]
    new_owner: AccountInfo<'info>,

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

pub fn submit_ownership_transfer_request(
    ctx: Context<SubmitOwnershipTransferRequest>,
) -> Result<()> {
    common::admin::utils::pending_owner::transfer_ownership(
        &mut ctx.accounts.custodian,
        &ctx.accounts.new_owner.key(),
    );

    // Set the upgrade authority to the custodian for now. It will be set to the new owner once the
    // ownership transfer is confirmed.
    #[cfg(not(feature = "integration-test"))]
    {
        common::admin::cpi::set_upgrade_authority_checked(
            CpiContext::new_with_signer(
                ctx.accounts
                    .bpf_loader_upgradeable_program
                    .to_account_info(),
                common::admin::cpi::SetUpgradeAuthorityChecked {
                    program_data: ctx.accounts.program_data.to_account_info(),
                    current_authority: ctx.accounts.owner.to_account_info(),
                    new_authority: ctx.accounts.custodian.to_account_info(),
                },
                &[&[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]]],
            ),
            crate::ID,
        )?;
    }

    // Done.
    Ok(())
}
