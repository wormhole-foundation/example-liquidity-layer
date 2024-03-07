use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct PayerSequence {
    pub value: u64,
}

impl PayerSequence {
    pub const SEED_PREFIX: &'static [u8] = b"seq";

    pub fn take_and_uptick(&mut self) -> u64 {
        let seq = self.value;

        self.value += 1;

        seq
    }
}
