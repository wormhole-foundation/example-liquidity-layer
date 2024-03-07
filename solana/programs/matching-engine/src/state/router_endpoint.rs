use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum MessageProtocol {
    Local {
        program_id: Pubkey,
    },
    Cctp {
        /// CCTP domain, which is how CCTP registers identifies foreign networks.
        domain: u32,
    },
    Canonical,
}

#[account]
#[derive(Debug, InitSpace)]
/// Foreign emitter account data.
pub struct RouterEndpoint {
    pub bump: u8,

    /// Emitter chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,

    /// Emitter address. Cannot be zero address.
    pub address: [u8; 32],

    /// Future-proof field in case another network has token accounts to send assets to instead of
    /// sending to the address directly.
    pub mint_recipient: [u8; 32],

    /// Specific message protocol used to move assets.
    pub protocol: MessageProtocol,
}

impl RouterEndpoint {
    pub const SEED_PREFIX: &'static [u8] = b"endpoint";
}
