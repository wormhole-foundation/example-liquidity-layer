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
    /// Bump seed for the custody token account associated with [PreparedFill].
    pub prepared_custody_token_bump: u8,

    /// Who paid the lamports to create the [PreparedFill] account.
    pub prepared_by: Pubkey,

    /// NOTE: If [FillType::Unset], the [PreparedFill] account is invalid.
    pub fill_type: FillType,

    /// Wormhole chain ID reflecting where the order was created.
    pub source_chain: u16,

    /// Universal address of the order sender.
    pub order_sender: [u8; 32],

    /// Authority allowed to redeem [PreparedFill].
    pub redeemer: Pubkey,

    /// Timestamp at the time a fill was issued. This time will either be a VAA time for a direct
    /// fill from another Token Router or timestamp from [matching_engine::state::FastFill] as a
    /// result of a market order.
    ///
    /// NOTE: This timestamp is not used by the Token Router. It only provides more information for
    /// an integrator so he can perform special handling based on when the fill happened.
    pub timestamp: i64,
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

    pub fn compute_size(payload_len: usize) -> usize {
        const FIXED: usize = 8 // DISCRIMINATOR
            + PreparedFillSeeds::INIT_SPACE
            + PreparedFillInfo::INIT_SPACE
            + 4 // payload len
        ;

        payload_len.saturating_add(FIXED)
    }
}

impl std::ops::Deref for PreparedFill {
    type Target = PreparedFillInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
