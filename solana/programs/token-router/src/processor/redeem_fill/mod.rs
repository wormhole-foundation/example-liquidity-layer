mod cctp;
pub use cctp::*;

mod me;
pub use me::*;

use anchor_lang::prelude::*;

/// Arguments used to invoke [redeem_fill_matching_engine].
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RedeemFillArgs {
    /// CCTP message.
    pub encoded_cctp_message: Vec<u8>,

    /// Attestation of [encoded_cctp_message](Self::encoded_cctp_message).
    pub cctp_attestation: Vec<u8>,
}
