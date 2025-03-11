use anchor_lang::prelude::*;
use solana_program::program_error::ProgramError;
use solana_program::instruction::Instruction;
use crate::state::FastMarketOrder;

pub struct CloseFastMarketOrderAccounts<'ix> {
    pub fast_market_order: &'ix Pubkey,
    pub refund_recipient: &'ix Pubkey,
}

impl<'ix> CloseFastMarketOrderAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new_readonly(*self.fast_market_order, false),
            AccountMeta::new_readonly(*self.refund_recipient, false),
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
            data: vec![],
        }
    }
}

pub fn close_fast_market_order(accounts: &[AccountInfo]) -> Result<()> {
    if accounts.len() < 2 {
        return Err(ProgramError::NotEnoughAccountKeys.into());
    }

    let fast_market_order = &accounts[0];
    let refund_recipient = &accounts[1];

    if !refund_recipient.is_signer {
        msg!("Refund recipient (account #2) is not a signer");
        return Err(ProgramError::InvalidAccountData.into());
    }

    let fast_market_order_data = FastMarketOrder::try_deserialize(&mut &fast_market_order.data.borrow()[..])?;
    if fast_market_order_data.refund_recipient != refund_recipient.key().as_ref() {
        msg!("Refund recipient (account #2) mismatch");
        msg!("Actual:");
        msg!("{:?}", refund_recipient.key.as_ref());
        msg!("Expected:");
        msg!("{:?}", fast_market_order_data.refund_recipient);
        return Err(ProgramError::InvalidAccountData.into());
    }

    let mut fast_market_order_lamports = fast_market_order.lamports.borrow_mut();
    **refund_recipient.lamports.borrow_mut() += **fast_market_order_lamports;
    **fast_market_order_lamports = 0;

    Ok(())
}