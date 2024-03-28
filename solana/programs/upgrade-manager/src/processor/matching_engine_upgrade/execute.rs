use crate::{composite::*, utils::AuthorizeUpgrade};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ExecuteMatchingEngineUpgrade<'info> {
    /// CHECK: This custodian is not serialized the same way as the new implementation's.
    #[account(mut)]
    matching_engine_custodian: AccountInfo<'info>,

    #[account(
        constraint = {
            require_keys_eq!(
                execute_upgrade.program.key(),
                matching_engine::id(),
            );

            true
        }
    )]
    execute_upgrade: ExecuteUpgrade<'info>,
}

impl<'info> AuthorizeUpgrade<'info> for ExecuteMatchingEngineUpgrade<'info> {
    fn execute_upgrade_composite_mut(&mut self) -> &mut ExecuteUpgrade<'info> {
        &mut self.execute_upgrade
    }

    fn authorize_upgrade(&self) -> Result<()> {
        let admin = &self.execute_upgrade.admin;
        let program = &self.execute_upgrade.program;
        let custodian = &self.matching_engine_custodian;

        matching_engine::cpi::submit_ownership_transfer_request(CpiContext::new(
            program.to_account_info(),
            matching_engine::cpi::accounts::SubmitOwnershipTransferRequest {
                admin: matching_engine::cpi::accounts::OwnerOnlyMut {
                    owner: admin.owner.to_account_info(),
                    custodian: custodian.to_account_info(),
                },
                new_owner: admin.upgrade_authority.to_account_info(),
            },
        ))?;

        matching_engine::cpi::confirm_ownership_transfer_request(CpiContext::new_with_signer(
            program.to_account_info(),
            matching_engine::cpi::accounts::ConfirmOwnershipTransferRequest {
                pending_owner: admin.upgrade_authority.to_account_info(),
                custodian: custodian.to_account_info(),
            },
            &[crate::UPGRADE_AUTHORITY_SIGNER_SEEDS],
        ))
    }
}
