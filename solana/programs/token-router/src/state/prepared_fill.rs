use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum FillType {
    Unset,
    WormholeCctpDeposit,
    FastFill,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedFillSeeds {
    pub fill_source: Pubkey,
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedFillInfo {
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
    pub seeds: PreparedFillSeeds,
    pub info: PreparedFillInfo,
    pub redeemer_message: Vec<u8>,
}

impl PreparedFill {
    pub const SEED_PREFIX: &'static [u8] = b"fill";

    pub fn checked_compute_size(payload_len: usize) -> Option<usize> {
        const FIXED: usize = 8 // DISCRIMINATOR
            + PreparedFillSeeds::INIT_SPACE
            + 1 // prepared_custody_token_bump
            + 32 // prepared_by
            + FillType::INIT_SPACE
            + 2 // source_chain
            + 32 // order_sender
            + 32 // redeemer
            + 4 // payload len
        ;

        payload_len.checked_add(FIXED)
    }
}

impl std::ops::Deref for PreparedFill {
    type Target = PreparedFillInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
