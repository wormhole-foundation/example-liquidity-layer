use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};
use anchor_lang::Discriminator;
use solana_program::program::invoke_signed_unchecked;
use solana_program::instruction::Instruction;

use super::create_account::create_account_reliably;

use super::FallbackMatchingEngineInstruction;
use crate::state::FastMarketOrder as FastMarketOrderState;
use super::errors::FallbackError;

pub struct InitialiseFastMarketOrderAccounts<'ix> {
    pub signer: &'ix Pubkey,
    pub fast_market_order_account: &'ix Pubkey,
    pub guardian_set: &'ix Pubkey,
    pub guardian_set_signatures: &'ix Pubkey,
    pub verify_vaa_shim_program: &'ix Pubkey,
    pub system_program: &'ix Pubkey,
}

impl<'ix> InitialiseFastMarketOrderAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.signer, true), // This will be the refund recipient
            AccountMeta::new(*self.fast_market_order_account, false),
            AccountMeta::new_readonly(*self.guardian_set, false),
            AccountMeta::new_readonly(*self.guardian_set_signatures, false),
            AccountMeta::new(*self.verify_vaa_shim_program, false),
            AccountMeta::new(*self.system_program, false),
        ]
    }
}

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct InitialiseFastMarketOrderData {
    pub fast_market_order: FastMarketOrderState,
    pub guardian_set_bump: u8,
    _padding: [u8; 7],
}
impl InitialiseFastMarketOrderData {
    pub fn new(fast_market_order: FastMarketOrderState, guardian_set_bump: u8) -> Self {
        Self { fast_market_order, guardian_set_bump, _padding: [0_u8; 7] }
    }

    pub fn from_bytes(data: &[u8]) -> Option<&Self> {
        bytemuck::try_from_bytes::<Self>(data).ok()
    }
}

pub struct InitialiseFastMarketOrder<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: InitialiseFastMarketOrderAccounts<'ix>,
    pub data: InitialiseFastMarketOrderData,
}

impl InitialiseFastMarketOrder<'_> {
    pub fn instruction(&self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: FallbackMatchingEngineInstruction::InitialiseFastMarketOrder(&self.data).to_vec(),
        }
    }
}

pub fn initialise_fast_market_order(accounts: &[AccountInfo], data: &InitialiseFastMarketOrderData) -> Result<()> {
    if accounts.len() < 6 {
        return Err(ErrorCode::AccountNotEnoughKeys.into());
    }
    let signer = &accounts[0];
    let fast_market_order_account = &accounts[1];
    let guardian_set = &accounts[2];
    let guardian_set_signatures = &accounts[3];
    let _verify_vaa_shim_program = &accounts[4];
    let _system_program = &accounts[5];

    let InitialiseFastMarketOrderData { fast_market_order, guardian_set_bump, _padding: _ } = *data;
    // Start of cpi call to verify the shim.
    // ------------------------------------------------------------------------------------------------
    
    // Did not want to pass in the vaa hash here. So recreated it.
    let verify_hash_data = {
        let mut data = vec![];
        data.extend_from_slice(&wormhole_svm_shim::verify_vaa::VerifyVaaShimInstruction::<false>::VERIFY_HASH_SELECTOR);
        data.push(guardian_set_bump);
        data.extend_from_slice(&fast_market_order.digest);
        data
    };
    let verify_shim_ix = Instruction {
        program_id: wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(guardian_set.key(), false),
            AccountMeta::new_readonly(guardian_set_signatures.key(), false),
        ],
        data: verify_hash_data,
    };
    // Make the cpi call to verify the shim.
    invoke_signed_unchecked(&verify_shim_ix, &[
        guardian_set.to_account_info(),
        guardian_set_signatures.to_account_info(),
    ], &[])?;
    // ------------------------------------------------------------------------------------------------
    // End of cpi call to verify the shim.

    let fast_market_order_key = fast_market_order_account.key();
    // Create the fast market order account
    let program_id = crate::ID;
    let space = 8 + std::mem::size_of::<FastMarketOrderState>();
    let (fast_market_order_pda, fast_market_order_bump) = Pubkey::find_program_address(
        &[
            FastMarketOrderState::SEED_PREFIX,
            fast_market_order.digest.as_ref(),
            fast_market_order.refund_recipient.as_ref(),
        ],
        &program_id,
    );

    if fast_market_order_pda != fast_market_order_key {
        msg!("Fast market order pda is invalid");
        return Err(FallbackError::InvalidPda.into()).map_err(|e: Error| e.with_pubkeys((fast_market_order_key, fast_market_order_pda)));
    }
    let fast_market_order_seeds = [
        FastMarketOrderState::SEED_PREFIX,
        fast_market_order.digest.as_ref(),
        fast_market_order.refund_recipient.as_ref(),
        &[fast_market_order_bump],
    ];
    let fast_market_order_signer_seeds = &[&fast_market_order_seeds[..]];
    // Create the account using the system program
    create_account_reliably(
        &signer.key(),
        &fast_market_order_key,
        fast_market_order_account.lamports(),
        space,
        accounts,
        &program_id,
        fast_market_order_signer_seeds,
    )?;

    // Borrow the account data mutably
    let mut fast_market_order_account_data = fast_market_order_account.try_borrow_mut_data()?;
    
    // Write the discriminator to the first 8 bytes
    let discriminator = FastMarketOrderState::discriminator();
    fast_market_order_account_data[0..8].copy_from_slice(&discriminator);

    let fast_market_order_bytes = bytemuck::bytes_of(&data.fast_market_order);
    // Ensure the destination has enough space
    if fast_market_order_account_data.len() < 8 + fast_market_order_bytes.len() {
        msg!("Account data buffer too small");
        return Err(FallbackError::AccountDataTooSmall.into());
    }

    // Write the fast_market_order struct to the account
    fast_market_order_account_data[8..8 + fast_market_order_bytes.len()].copy_from_slice(fast_market_order_bytes);

    Ok(())
}