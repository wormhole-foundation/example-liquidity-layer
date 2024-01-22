use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub enum OrderType {
    Market { min_amount_out: Option<u64> },
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PreparedOrderInfo {
    pub order_sender: Pubkey,
    pub payer: Pubkey,

    pub order_type: OrderType,
    pub order_token: Pubkey,
    pub refund_token: Pubkey,

    pub amount_in: u64,
    pub target_chain: u16,
    pub redeemer: [u8; 32],
}

#[account]
#[derive(Debug)]
pub struct PreparedOrder {
    pub info: Box<PreparedOrderInfo>,
    pub redeemer_message: Vec<u8>,
}

impl PreparedOrder {
    pub(crate) fn compute_size(message_len: usize) -> usize {
        8 + PreparedOrderInfo::INIT_SPACE + 4 + message_len
    }
}

impl std::ops::Deref for PreparedOrder {
    type Target = PreparedOrderInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
