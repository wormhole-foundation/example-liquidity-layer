use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum OrderType {
    Market { min_amount_out: Option<u64> },
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedOrderInfo {
    pub prepared_custody_token_bump: u8,

    pub order_sender: Pubkey,
    pub prepared_by: Pubkey,

    pub order_type: OrderType,
    pub src_token: Pubkey,
    pub refund_token: Pubkey,

    pub target_chain: u16,
    pub redeemer: [u8; 32],
}

#[account]
#[derive(Debug)]
pub struct PreparedOrder {
    pub info: PreparedOrderInfo,
    pub redeemer_message: Vec<u8>,
}

impl PreparedOrder {
    pub(crate) fn compute_size(redeemer_message_len: usize) -> usize {
        const FIXED: usize = 8 // DISCRIMINATOR
            + PreparedOrderInfo::INIT_SPACE
            + 4 // redeemer_message_len
        ;

        redeemer_message_len.saturating_add(FIXED)
    }
}

impl std::ops::Deref for PreparedOrder {
    type Target = PreparedOrderInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
