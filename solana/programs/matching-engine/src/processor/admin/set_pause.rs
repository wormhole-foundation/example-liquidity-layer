use crate::composite::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetPause<'info> {
    admin: AdminMut<'info>,
}

pub fn set_pause(ctx: Context<SetPause>, paused: bool) -> Result<()> {
    let custodian = &mut ctx.accounts.admin.custodian;
    custodian.paused = paused;
    custodian.paused_set_by = ctx.accounts.admin.owner_or_assistant.key();

    // Done.
    Ok(())
}
