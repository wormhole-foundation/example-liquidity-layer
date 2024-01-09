use anchor_lang::prelude::constant;

/// Seed for upgrade authority.
#[constant]
pub const UPGRADE_SEED_PREFIX: &[u8] = b"upgrade";

/// Seed for custody token account.
#[constant]
pub const CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"custody";

/// Nonce for outbound messages.
#[constant]
pub const NONCE: u32 = 0;

/// Fee precison max.
#[constant]
pub const FEE_PRECISION_MAX: u32 = 1_000_000;