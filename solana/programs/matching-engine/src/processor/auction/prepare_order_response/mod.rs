mod cctp;
pub use cctp::*;

use anchor_lang::prelude::*;

fn prepare_order_response_noop() -> Result<()> {
    msg!("Already prepared");

    // No-op.
    Ok(())
}
