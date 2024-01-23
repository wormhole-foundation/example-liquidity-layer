use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum FillType {
    Unset,
    WormholeCctpDeposit,
    FastFill,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct PreparedFill {
    pub vaa_hash: [u8; 32],
    pub bump: u8,

    pub redeemer: Pubkey,
    pub prepared_by: Pubkey,

    pub fill_type: FillType,
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub amount: u64,
}

impl PreparedFill {
    pub const SEED_PREFIX: &'static [u8] = b"fill";
}
