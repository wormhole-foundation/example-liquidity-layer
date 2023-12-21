use anchor_lang::prelude::constant;

/// Swap rate precision. This value should NEVER change, unless other Token
/// Bridge Relayer contracts are deployed with a different precision.
#[constant]
pub const NATIVE_SWAP_RATE_PRECISION: u128 = u128::pow(10, 8);

/// Seed for custody token account.
#[constant]
pub const CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"custody";
