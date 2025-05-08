use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;

use crate::{error::MatchingEngineError, state::FastMarketOrder};

pub struct CloseFastMarketOrderAccounts<'ix> {
    /// The fast market order account to be closed.
    pub fast_market_order: &'ix Pubkey,
    /// The account that will receive rent from the fast market order account.
    /// This account is the only authority that can close the fast market order.
    /// TODO: Rename to "refund_recipient".
    pub close_account_refund_recipient: &'ix Pubkey,
}

/// Closes the fast market order and transfers the lamports from the fast market
/// order to its refund recipient.
pub struct CloseFastMarketOrder<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: CloseFastMarketOrderAccounts<'ix>,
}

impl CloseFastMarketOrder<'_> {
    pub fn instruction(&self) -> Instruction {
        let CloseFastMarketOrderAccounts {
            fast_market_order,
            close_account_refund_recipient: refund_recipient,
        } = self.accounts;

        Instruction {
            program_id: *self.program_id,
            accounts: vec![
                AccountMeta::new(*fast_market_order, false),
                AccountMeta::new(*refund_recipient, true),
            ],
            data: super::FallbackMatchingEngineInstruction::CloseFastMarketOrder.to_vec(),
        }
    }
}

pub fn close_fast_market_order(accounts: &[AccountInfo]) -> Result<()> {
    super::helpers::require_min_account_infos_len(accounts, 2)?;

    // We need to check the refund recipient account against what we know as the
    // refund recipient encoded in the fast market order account.
    let fast_market_order_info = &accounts[0];
    let refund_recipient_info = &accounts[1];

    let fast_market_order_data = &fast_market_order_info.data.borrow()[..];

    // NOTE: We do not need to verify that the owner of this account is this
    // program because the lamport transfer will fail otherwise.
    let fast_market_order = FastMarketOrder::try_read(fast_market_order_data)?;

    // Check that the refund recipient provided in this instruction is the one
    // encoded in the fast market order account.
    let expected_refund_recipient_key = fast_market_order.close_account_refund_recipient;
    if refund_recipient_info.key != &expected_refund_recipient_key {
        return Err(MatchingEngineError::MismatchingCloseAccountRefundRecipient.into()).map_err(
            |e: Error| e.with_pubkeys((*refund_recipient_info.key, expected_refund_recipient_key)),
        );
    }

    // This refund recipient must sign to invoke this instruction. He is the
    // only authority allowed to perform this action.
    if !refund_recipient_info.is_signer {
        return Err(ErrorCode::AccountNotSigner.into())
            .map_err(|e: Error| e.with_account_name("refund_recipient"));
    }

    let mut fast_market_order_info_lamports = fast_market_order_info.lamports.borrow_mut();

    // Move lamports to the refund recipient.
    let mut recipient_info_lamports = refund_recipient_info.lamports.borrow_mut();
    **recipient_info_lamports =
        recipient_info_lamports.saturating_add(**fast_market_order_info_lamports);

    // Zero out the fast market order lamports.
    **fast_market_order_info_lamports = 0;

    Ok(())
}
