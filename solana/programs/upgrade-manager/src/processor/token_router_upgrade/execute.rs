use crate::{composite::*, utils::AuthorizeUpgrade};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ExecuteTokenRouterUpgrade<'info> {
    /// CHECK: Seeds must be \["emitter"\] (Token Router program).
    #[account(mut)]
    token_router_custodian: UncheckedAccount<'info>,

    #[account(
        constraint = {
            require_keys_eq!(
                execute_upgrade.program.key(),
                token_router::id(),
            );

            true
        }
    )]
    execute_upgrade: ExecuteUpgrade<'info>,
}

impl<'info> AuthorizeUpgrade<'info> for ExecuteTokenRouterUpgrade<'info> {
    fn execute_upgrade_composite_mut(&mut self) -> &mut ExecuteUpgrade<'info> {
        &mut self.execute_upgrade
    }

    fn authorize_upgrade(&self) -> Result<()> {
        let admin = &self.execute_upgrade.admin;
        let program = &self.execute_upgrade.program;
        let custodian = &self.token_router_custodian;

        token_router::cpi::submit_ownership_transfer_request(CpiContext::new(
            program.to_account_info(),
            token_router::cpi::accounts::SubmitOwnershipTransferRequest {
                admin: token_router::cpi::accounts::OwnerOnlyMut {
                    owner: admin.owner.to_account_info(),
                    custodian: custodian.to_account_info(),
                },
                new_owner: admin.upgrade_authority.to_account_info(),
            },
        ))?;

        token_router::cpi::confirm_ownership_transfer_request(CpiContext::new_with_signer(
            program.to_account_info(),
            token_router::cpi::accounts::ConfirmOwnershipTransferRequest {
                pending_owner: admin.upgrade_authority.to_account_info(),
                custodian: custodian.to_account_info(),
            },
            &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
        ))
    }
}
