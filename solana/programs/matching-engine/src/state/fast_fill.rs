use anchor_lang::prelude::*;
use common::messages::Fill;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct FastFillInfo {
    pub amount: u64,
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer: Pubkey,
}

#[account]
#[derive(Debug)]
pub struct FastFill {
    pub bump: u8,
    pub prepared_by: Pubkey,
    pub redeemed: bool,
    pub info: FastFillInfo,
    pub redeemer_message: Vec<u8>,
}

impl FastFill {
    pub const SEED_PREFIX: &'static [u8] = b"fast-fill";

    pub(crate) fn checked_compute_size(redeemer_message_len: usize) -> Option<usize> {
        const FIXED: usize = 8 // DISCRIMINATOR
        + 1 // bump
        + 32 // prepared_by
        + 1 // redeemed
        + FastFillInfo::INIT_SPACE
        + 4 // redeemer_message len
        ;

        redeemer_message_len
            .checked_add(FIXED)
            .filter(|&size| size <= super::MAX_CPI_ALLOCATE_SIZE)
    }

    pub fn new(bump: u8, prepared_by: Pubkey, amount: u64, fill: Fill) -> Self {
        let Fill {
            source_chain,
            order_sender,
            redeemer,
            redeemer_message,
        } = fill;
        Self {
            bump,
            prepared_by,
            redeemed: Default::default(),
            info: FastFillInfo {
                amount,
                source_chain,
                order_sender,
                redeemer: Pubkey::from(redeemer),
            },
            redeemer_message: redeemer_message.into(),
        }
    }
}
