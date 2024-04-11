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
    pub(crate) fn compute_size(message_len: usize) -> usize {
        // We should not expect `message_len` to cause this operation to overflow.
        #[allow(clippy::arithmetic_side_effects)]
        let out = 8 + PreparedOrderInfo::INIT_SPACE + 4 + message_len;

        out
    }
}

impl std::ops::Deref for PreparedOrder {
    type Target = PreparedOrderInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
