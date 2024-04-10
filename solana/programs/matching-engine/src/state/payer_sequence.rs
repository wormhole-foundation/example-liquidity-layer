use anchor_lang::prelude::*;

use crate::error::MatchingEngineError;

#[account]
#[derive(InitSpace)]
pub struct PayerSequence {
    pub value: u64,
}

impl PayerSequence {
    pub const SEED_PREFIX: &'static [u8] = b"seq";

    pub fn take_and_uptick(&mut self) -> Result<u64> {
        let seq = self.value;

        self.value = seq.checked_add(1).ok_or(MatchingEngineError::U64Overflow)?;

        Ok(seq)
    }
}

impl std::ops::Deref for PayerSequence {
    type Target = u64;

    fn deref(&self) -> &Self::Target {
        &self.value
    }
}
