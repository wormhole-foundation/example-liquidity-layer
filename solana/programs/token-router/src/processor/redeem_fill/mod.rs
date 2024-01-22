mod cctp;
pub use cctp::*;

mod fast;
pub use fast::*;

use anchor_lang::prelude::*;

fn redeem_fill_noop() -> Result<()> {
    msg!("Already redeemed");

    // No-op.
    Ok(())
}
