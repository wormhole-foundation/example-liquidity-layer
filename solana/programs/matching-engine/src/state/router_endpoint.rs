use anchor_lang::prelude::*;

/// Protocol used to transfer assets.
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace, Copy)]
pub enum MessageProtocol {
    /// Unassigned or disabled.
    None,
    /// Tokens destined for this network (Solana).
    Local { program_id: Pubkey },
    /// Tokens to be burned and minted via Circle's CCTP protocol.
    Cctp {
        /// CCTP domain, which is how CCTP registers identifies foreign networks.
        domain: u32,
    },
}

impl std::fmt::Display for MessageProtocol {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MessageProtocol::None => write!(f, "None"),
            MessageProtocol::Local { program_id } => {
                write!(f, "Local {{ program_id: {} }}", program_id)
            }
            MessageProtocol::Cctp { domain } => write!(f, "Cctp {{ domain: {} }}", domain),
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct EndpointInfo {
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

#[account]
#[derive(Debug, InitSpace)]
/// Foreign emitter account data.
pub struct RouterEndpoint {
    pub bump: u8,
    pub info: EndpointInfo,
}

impl std::ops::Deref for RouterEndpoint {
    type Target = EndpointInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}

impl RouterEndpoint {
    pub const SEED_PREFIX: &'static [u8] = b"endpoint";
}
