use crate::state::FastMarketOrder;
use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program_error::ProgramError;

use super::helpers::check_account_length;
use super::FallbackMatchingEngineInstruction;

pub struct CloseFastMarketOrderAccounts<'ix> {
    /// The fast market order account created from the initialise fast market order instruction
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
    check_account_length(accounts, 2)?;

    let fast_market_order = &accounts[0];
    let close_account_refund_recipient = &accounts[1];

    if !close_account_refund_recipient.is_signer {
        msg!("Refund recipient (account #2) is not a signer");
        return Err(ProgramError::InvalidAccountData.into());
    }

    let fast_market_order_data =
        FastMarketOrder::try_deserialize(&mut &fast_market_order.data.borrow()[..])?;
    if fast_market_order_data.close_account_refund_recipient
        != close_account_refund_recipient.key().as_ref()
    {
        return Err(ProgramError::InvalidAccountData.into()).map_err(|e: Error| {
            e.with_pubkeys((
                Pubkey::try_from(fast_market_order_data.close_account_refund_recipient)
                    .expect("Failed to convert close account refund recipient to pubkey"),
                close_account_refund_recipient.key(),
            ))
        });
    }

    // Transfer the lamports from the fast market order to the close account refund recipient
    let mut fast_market_order_lamports = fast_market_order.lamports.borrow_mut();
    **close_account_refund_recipient.lamports.borrow_mut() += **fast_market_order_lamports;
    **fast_market_order_lamports = 0;

    Ok(())
}
