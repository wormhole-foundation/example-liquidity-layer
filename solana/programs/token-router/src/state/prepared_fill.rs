use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum FillType {
    Unset,
    WormholeCctpDeposit,
    FastFill,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedFillInfo {
    pub vaa_hash: [u8; 32],
    pub bump: u8,
    pub prepared_custody_token_bump: u8,

    pub prepared_by: Pubkey,

    pub fill_type: FillType,

    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer: Pubkey,
}

#[account]
#[derive(Debug)]
pub struct PreparedFill {
    pub info: PreparedFillInfo,
    pub redeemer_message: Vec<u8>,
}

impl PreparedFill {
    pub const SEED_PREFIX: &'static [u8] = b"fill";

    pub fn compute_size(payload_len: usize) -> usize {
        8 + 32 + 1 + 32 + 32 + FillType::INIT_SPACE + 8 + 2 + 32 + 4 + payload_len
    }
}

impl std::ops::Deref for PreparedFill {
    type Target = PreparedFillInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
