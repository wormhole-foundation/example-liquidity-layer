mod cctp;
pub use cctp::*;

mod fast;
pub use fast::*;

use anchor_lang::prelude::*;

/// Arguments used to invoke [redeem_fast_fill].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RedeemFillArgs {
    /// CCTP message.
    pub encoded_cctp_message: Vec<u8>,

    /// Attestation of [encoded_cctp_message](Self::encoded_cctp_message).
    pub cctp_attestation: Vec<u8>,
}
