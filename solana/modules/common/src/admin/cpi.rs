#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;
use solana_program::bpf_loader_upgradeable;

#[derive(Accounts)]
pub struct SetUpgradeAuthorityChecked<'info> {
    #[account(mut)]
    pub program_data: AccountInfo<'info>,

    #[account(signer)]
    pub current_authority: AccountInfo<'info>,

    #[account(signer)]
    pub new_authority: AccountInfo<'info>,
}

pub fn set_upgrade_authority_checked<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, SetUpgradeAuthorityChecked<'info>>,
    program_id: Pubkey,
) -> Result<()> {
    solana_program::program::invoke_signed(
        &bpf_loader_upgradeable::set_upgrade_authority_checked(
            &program_id,
            &ctx.accounts.current_authority.key(),
            &ctx.accounts.new_authority.key(),
        ),
        &ctx.to_account_infos(),
        ctx.signer_seeds,
    )
    .map_err(Into::into)
}
