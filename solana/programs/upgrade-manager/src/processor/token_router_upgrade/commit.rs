use crate::{composite::*, UPGRADE_AUTHORITY_SIGNER_SEEDS};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CommitTokenRouterUpgrade<'info> {
    #[account(mut)]
    token_router_custodian: Account<'info, token_router::state::Custodian>,

    #[account(
        constraint = {
            require_keys_eq!(
                commit_upgrade.program.key(),
                token_router::id(),
            );

            true
        }
    )]
    commit_upgrade: CommitUpgrade<'info>,
}

pub fn commit_token_router_upgrade(ctx: Context<CommitTokenRouterUpgrade>) -> Result<()> {
    let custodian = &ctx.accounts.token_router_custodian;
    let CommitUpgrade { admin, program, .. } = &ctx.accounts.commit_upgrade;

    // NOTE: We do not want to pass in any remaining accounts to this instruction.
    token_router::cpi::migrate(CpiContext::new_with_signer(
        program.to_account_info(),
        token_router::cpi::accounts::Migrate {
            admin: token_router::cpi::accounts::OwnerOnly {
                owner: admin.upgrade_authority.to_account_info(),
                custodian: token_router::cpi::accounts::CheckedCustodian {
                    custodian: custodian.to_account_info(),
                },
            },
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    token_router::cpi::submit_ownership_transfer_request(CpiContext::new_with_signer(
        program.to_account_info(),
        token_router::cpi::accounts::SubmitOwnershipTransferRequest {
            admin: token_router::cpi::accounts::OwnerOnlyMut {
                owner: admin.upgrade_authority.to_account_info(),
                custodian: custodian.to_account_info(),
            },
            new_owner: admin.owner.to_account_info(),
        },
        &[UPGRADE_AUTHORITY_SIGNER_SEEDS],
    ))?;

    token_router::cpi::confirm_ownership_transfer_request(CpiContext::new(
        program.to_account_info(),
        token_router::cpi::accounts::ConfirmOwnershipTransferRequest {
            pending_owner: admin.owner.to_account_info(),
            custodian: custodian.to_account_info(),
        },
    ))
}
