mod reserved_sequence;
pub use reserved_sequence::*;

mod sequencer;
pub use sequencer::*;

use anchor_lang::prelude::*;
use common::messages::Fill;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct FastFillInfo {
    /// Who paid the lamports to create the [FastFill] account.
    pub prepared_by: Pubkey,

    /// Fill amount.
    pub amount: u64,

    /// Authority allowed to redeem [FastFill].
    pub redeemer: Pubkey,

    /// Timestamp at the time a fill was issued. When the fast fill is created, it is set using the
    /// current [Clock] unix timestamp.
    pub timestamp: i64,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct FastFillSeeds {
    /// Wormhole chain ID reflecting where the order was created.
    pub source_chain: u16,

    /// Universal address of the order sender.
    pub order_sender: [u8; 32],

    /// Sequence generated by the [FastFillSequencer](crate::state::FastFillSequencer) when it
    /// reserved a sequence number for this fill.
    pub sequence: u64,

    /// Bump seed for the [FastFill] account.
    pub bump: u8,
}

#[account]
#[derive(Debug)]
pub struct FastFill {
    pub seeds: FastFillSeeds,

    /// Whether the [FastFill] has been redeemed via the local Token Router.
    pub redeemed: bool,

    pub info: FastFillInfo,
    pub redeemer_message: Vec<u8>,
}

impl FastFill {
    pub const SEED_PREFIX: &'static [u8] = b"fast-fill";

    pub(crate) fn compute_size(redeemer_message_len: usize) -> usize {
        const FIXED: usize = 8 // DISCRIMINATOR
            + FastFillSeeds::INIT_SPACE
            + 1 // redeemed
            + FastFillInfo::INIT_SPACE
            + 4 // redeemer_message len
        ;

        redeemer_message_len.saturating_add(FIXED)
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
