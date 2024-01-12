pub mod usdc;

pub const WORMHOLE_MESSAGE_NONCE: u32 = 0;

/// Seed for custody token account.
pub const CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"custody";

pub const CORE_MESSAGE_SEED_PREFIX: &[u8] = b"msg";

pub const FEE_PRECISION_MAX: u32 = 1_000_000;
