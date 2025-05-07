use crate::error::MatchingEngineError;
use crate::state::FastMarketOrder;
use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program_error::ProgramError;

use super::helpers::require_min_account_infos_len;
use super::FallbackMatchingEngineInstruction;

pub struct CloseFastMarketOrderAccounts<'ix> {
    /// The fast market order account created from the initialize fast market order instruction
    pub fast_market_order: &'ix Pubkey,
    /// The account that will receive the refund. CHECK: Must be a signer.
    /// CHECK: Must match the close account refund recipient in the fast market order account
    pub close_account_refund_recipient: &'ix Pubkey,
}

impl<'ix> CloseFastMarketOrderAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.fast_market_order, false),
            AccountMeta::new(*self.close_account_refund_recipient, true),
        ]
    }
}

pub struct CloseFastMarketOrder<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: CloseFastMarketOrderAccounts<'ix>,
}

impl CloseFastMarketOrder<'_> {
    pub fn instruction(&self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: FallbackMatchingEngineInstruction::CloseFastMarketOrder.to_vec(),
        }
    }
}

/// Closes the fast market order and transfers the lamports from the fast market order to the close account refund recipient
///
/// # Arguments
///
/// * `accounts` - The accounts of the fast market order and the close account refund recipient
///
/// # Returns
///
/// Result<()>
pub fn close_fast_market_order(accounts: &[AccountInfo]) -> Result<()> {
    require_min_account_infos_len(accounts, 2)?;

    let fast_market_order = &accounts[0];
    let close_account_refund_recipient = &accounts[1];

    // Check that the close_account_refund_recipient is a signer, otherwise someone might call this and steal the lamports
    if !close_account_refund_recipient.is_signer {
        msg!("Refund recipient (account #2) is not a signer");
        return Err(ProgramError::InvalidAccountData.into());
    }
    let fast_market_order_data = &fast_market_order.data.borrow()[..];
    let fast_market_order_deserialized = FastMarketOrder::try_read(fast_market_order_data)?;
    // Check that the fast_market_order is owned by the close_account_refund_recipient
    if fast_market_order_deserialized.close_account_refund_recipient
        != close_account_refund_recipient.key()
    {
        return Err(MatchingEngineError::MismatchingCloseAccountRefundRecipient.into()).map_err(
            |e: Error| {
                e.with_pubkeys((
                    fast_market_order_deserialized.close_account_refund_recipient,
                    close_account_refund_recipient.key(),
                ))
            },
        );
    }

    // First, get the current lamports value
    let current_recipient_lamports = **close_account_refund_recipient.lamports.borrow();

    // Then, get the fast market order lamports
    let mut fast_market_order_lamports = fast_market_order.lamports.borrow_mut();

    // Calculate the new amount
    let new_amount = current_recipient_lamports.saturating_add(**fast_market_order_lamports);

    // Now update the recipient's lamports
    **close_account_refund_recipient.lamports.borrow_mut() = new_amount;

    // Zero out the fast market order lamports
    **fast_market_order_lamports = 0;

    Ok(())
}
