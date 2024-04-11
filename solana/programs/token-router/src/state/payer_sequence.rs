use anchor_lang::prelude::*;

use crate::error::TokenRouterError;

#[account]
#[derive(Debug, InitSpace)]
pub struct PayerSequence {
    pub value: u64,
}

impl PayerSequence {
    pub const SEED_PREFIX: &'static [u8] = b"seq";

    pub fn take_and_uptick(&mut self) -> Result<u64> {
        let seq = self.value;

        self.value = seq.checked_add(1).ok_or(TokenRouterError::U64Overflow)?;

        Ok(seq)
    }
}
