use anchor_lang::prelude::*;

use crate::composite::*;

#[derive(Accounts)]
pub struct InitEventSubscription<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: OwnerOnly<'info>,

    /// This account will be serialized with an event, so its discriminator will change with every
    /// update.
    ///
    /// CHECK: Mutable, must have seeds \["event"\].
    #[account(
        init,
        payer = payer,
        space = 10_240,
        seeds = [b"event"],
        bump,
    )]
    event_subscription: UncheckedAccount<'info>,

    system_program: Program<'info, System>,
}
