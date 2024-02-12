pub const WORMHOLE_MESSAGE_NONCE: u32 = 0;

/// Seed for custody token account.
pub const CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"custody";

pub const CORE_MESSAGE_SEED_PREFIX: &[u8] = b"core-msg";
pub const CCTP_MESSAGE_SEED_PREFIX: &[u8] = b"cctp-msg";

pub const FEE_PRECISION_MAX: u32 = 1_000_000;

pub use wormhole_solana_consts::USDC_MINT;
