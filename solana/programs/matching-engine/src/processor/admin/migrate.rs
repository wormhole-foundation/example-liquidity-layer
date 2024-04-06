use crate::composite::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Migrate<'info> {
    admin: OwnerOnly<'info>,
}

pub fn migrate(_ctx: Context<Migrate>) -> Result<()> {
    msg!("Nothing to migrate");

    Ok(())
}
