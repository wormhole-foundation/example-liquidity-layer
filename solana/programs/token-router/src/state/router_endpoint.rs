use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
/// Foreign emitter account data.
pub struct RouterEndpoint {
    pub bump: u8,

    /// Emitter chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,

    /// Emitter address. Cannot be zero address.
    pub address: [u8; 32],

    /// CCTP domain, which is how CCTP registers identifies foreign networks. If there is no CCTP
    /// for a given foreign network, this field is `None`.
    pub cctp_domain: Option<u32>,
}

impl RouterEndpoint {
    pub const SEED_PREFIX: &'static [u8] = b"endpoint";
}
