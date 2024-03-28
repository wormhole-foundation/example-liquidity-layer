use crate::{composite::*, UPGRADE_AUTHORITY_SIGNER_SEEDS};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CommitMatchingEngineUpgrade<'info> {
    /// CHECK: This custodian is not serialized the same way as the new implementation's.
    #[account(mut)]
    matching_engine_custodian: AccountInfo<'info>,

    #[account(
        constraint = {
            require_keys_eq!(
                commit_upgrade.program.key(),
                matching_engine::id(),
            );

            true
        }
    )]
    commit_upgrade: CommitUpgrade<'info>,

    #[account(mut)]
    payer: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn commit_matching_engine_upgrade(ctx: Context<CommitMatchingEngineUpgrade>) -> Result<()> {
    let custodian = &ctx.accounts.matching_engine_custodian;
    let CommitUpgrade { admin, program, .. } = &ctx.accounts.commit_upgrade;

    // NOTE: We do not want to pass in any remaining accounts to this instruction.
    // matching_engine::cpi::migrate(CpiContext::new_with_signer(
    //     program.to_account_info(),
    //     matching_engine::cpi::accounts::Migrate {
    //         admin: matching_engine::cpi::accounts::OwnerOnly {
    //             owner: admin.upgrade_authority.to_account_info(),
    //             custodian: matching_engine::cpi::accounts::CheckedCustodian {
    //                 custodian: custodian.to_account_info(),
    //             },
    //         },
    //     },
    //     &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    // ))?;
    matching_engine::cpi::migrate(CpiContext::new_with_signer(
        program.to_account_info(),
        matching_engine::cpi::accounts::Migrate {
            owner: admin.upgrade_authority.to_account_info(),
            custodian: custodian.to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    matching_engine::cpi::submit_ownership_transfer_request(CpiContext::new_with_signer(
        program.to_account_info(),
        matching_engine::cpi::accounts::SubmitOwnershipTransferRequest {
            admin: matching_engine::cpi::accounts::OwnerOnlyMut {
                owner: admin.upgrade_authority.to_account_info(),
                custodian: custodian.to_account_info(),
            },
            new_owner: admin.owner.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    matching_engine::cpi::confirm_ownership_transfer_request(CpiContext::new(
        program.to_account_info(),
        matching_engine::cpi::accounts::ConfirmOwnershipTransferRequest {
            pending_owner: admin.owner.to_account_info(),
            custodian: custodian.to_account_info(),
        },
    ))
}
