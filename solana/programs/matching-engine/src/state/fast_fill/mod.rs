mod reserved_sequence;
pub use reserved_sequence::*;

mod sequencer;
pub use sequencer::*;

use anchor_lang::prelude::*;
use common::messages::Fill;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct FastFillInfo {
    pub prepared_by: Pubkey,
    pub amount: u64,
    pub redeemer: Pubkey,
    pub timestamp: i64,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct FastFillSeeds {
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub sequence: u64,
    pub bump: u8,
}

#[account]
#[derive(Debug)]
pub struct FastFill {
    pub seeds: FastFillSeeds,
    pub redeemed: bool,
    pub info: FastFillInfo,
    pub redeemer_message: Vec<u8>,
}

impl FastFill {
    pub const SEED_PREFIX: &'static [u8] = b"fast-fill";

    pub(crate) fn checked_compute_size(redeemer_message_len: usize) -> Option<usize> {
        const FIXED: usize = 8 // DISCRIMINATOR
        + FastFillSeeds::INIT_SPACE
        + 1 // redeemed
        + FastFillInfo::INIT_SPACE
        + 4 // redeemer_message len
        ;

        redeemer_message_len
            .checked_add(FIXED)
            .filter(|&size| size <= super::MAX_CPI_ALLOCATE_SIZE)
    }

    pub fn new(fill: Fill, sequence: u64, bump: u8, prepared_by: Pubkey, amount: u64) -> Self {
        let Fill {
            source_chain,
            order_sender,
            redeemer,
            redeemer_message,
        } = fill;
        Self {
            seeds: FastFillSeeds {
                source_chain,
                order_sender,
                sequence,
                bump,
            },
            redeemed: Default::default(),
            info: FastFillInfo {
                prepared_by,
                amount,
                redeemer: Pubkey::from(redeemer),
                timestamp: Clock::get().unwrap().unix_timestamp,
            },
            redeemer_message: redeemer_message.into(),
        }
    }
}
