use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum FillType {
    Unset,
    WormholeCctpDeposit,
    FastFill,
}

#[account]
#[derive(Debug)]
pub struct PreparedFill {
    pub vaa_hash: [u8; 32],
    pub bump: u8,

    pub redeemer: Pubkey,
    pub prepared_by: Pubkey,

    pub fill_type: FillType,
    pub amount: u64,

    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer_message: Vec<u8>,
}

impl PreparedFill {
    pub const SEED_PREFIX: &'static [u8] = b"fill";

    pub fn compute_size(payload_len: usize) -> usize {
        8 + 32 + 1 + 32 + 32 + FillType::INIT_SPACE + 8 + 2 + 32 + 4 + payload_len
    }
}
