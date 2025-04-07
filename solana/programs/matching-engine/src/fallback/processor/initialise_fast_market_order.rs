use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use bytemuck::{Pod, Zeroable};
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed_unchecked;

use super::helpers::create_account_reliably;

use super::helpers::check_account_length;
use super::FallbackMatchingEngineInstruction;
use crate::error::MatchingEngineError;
use crate::state::FastMarketOrder as FastMarketOrderState;

pub struct InitialiseFastMarketOrderAccounts<'ix> {
    /// The signer of the transaction
    pub signer: &'ix Pubkey,
    /// The fast market order account pubkey (that is created by the instruction)
    pub fast_market_order_account: &'ix Pubkey,
    /// The guardian set account pubkey
    pub guardian_set: &'ix Pubkey,
    /// The guardian set signatures account pubkey (created by the post verify vaa shim program)
    pub guardian_set_signatures: &'ix Pubkey,
    /// The verify vaa shim program pubkey
    pub verify_vaa_shim_program: &'ix Pubkey,
    /// The system program account pubkey
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
    /// The fast market order as the bytemuck struct
    pub fast_market_order: FastMarketOrderState,
    /// The guardian set bump
    pub guardian_set_bump: u8,
    /// Padding to ensure bytemuck deserialization works
    _padding: [u8; 7],
}
impl InitialiseFastMarketOrderData {
    // Adds the padding to the InitialiseFastMarketOrderData
    pub fn new(fast_market_order: FastMarketOrderState, guardian_set_bump: u8) -> Self {
        Self {
            fast_market_order,
            guardian_set_bump,
            _padding: [0_u8; 7],
        }
    }

    /// Deserializes the InitialiseFastMarketOrderData from a byte slice
    ///
    /// # Arguments
    ///
    /// * `data` - A byte slice containing the InitialiseFastMarketOrderData
    ///
    /// # Returns
    ///
    /// Option<&Self> - The deserialized InitialiseFastMarketOrderData or None if the byte slice is not the correct length
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

/// Initialises the fast market order account
///
/// The verify shim program first checks that the digest of the fast market order is correct, and that the guardian signature is correct and recoverable.
/// If this is the case, the fast market order account is created. The fast market order account is owned by the matching engine program. It can be closed
/// by the close fast market order instruction, which returns the lamports to the close account refund recipient.
///
/// # Arguments
///
/// * `accounts` - The accounts of the fast market order and the guardian set
///
/// # Returns
///
/// Result<()>
pub fn initialise_fast_market_order(
    accounts: &[AccountInfo],
    data: &InitialiseFastMarketOrderData,
) -> Result<()> {
    check_account_length(accounts, 6)?;

    let program_id = crate::ID;

    let signer = &accounts[0];
    let fast_market_order_account = &accounts[1];
    let guardian_set = &accounts[2];
    let guardian_set_signatures = &accounts[3];

    let InitialiseFastMarketOrderData {
        fast_market_order,
        guardian_set_bump,
        _padding: _,
    } = *data;
    // Start of cpi call to verify the shim.
    // ------------------------------------------------------------------------------------------------
    let fast_market_order_vaa_digest = fast_market_order.digest();
    // Did not want to pass in the vaa hash here. So recreated it.
    let verify_hash_data = {
        let mut data = vec![];
        data.extend_from_slice(
            &wormhole_svm_shim::verify_vaa::VerifyVaaShimInstruction::<false>::VERIFY_HASH_SELECTOR,
        );
        data.push(guardian_set_bump);
        data.extend_from_slice(&fast_market_order_vaa_digest);
        data
    };
    let verify_shim_ix = Instruction {
        program_id: wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID, // Because program is hardcoded, the check is not needed.
        accounts: vec![
            AccountMeta::new_readonly(guardian_set.key(), false),
            AccountMeta::new_readonly(guardian_set_signatures.key(), false),
        ],
        data: verify_hash_data,
    };
    // Make the cpi call to verify the shim.
    invoke_signed_unchecked(
        &verify_shim_ix,
        &[
            guardian_set.to_account_info(),
            guardian_set_signatures.to_account_info(),
        ],
        &[],
    )?;
    // ------------------------------------------------------------------------------------------------
    // End of cpi call to verify the shim.

    // Start of fast market order account creation
    // ------------------------------------------------------------------------------------------------
    let fast_market_order_key = fast_market_order_account.key();
    let space = 8_usize.saturating_add(std::mem::size_of::<FastMarketOrderState>());
    let (fast_market_order_pda, fast_market_order_bump) = Pubkey::find_program_address(
        &[
            FastMarketOrderState::SEED_PREFIX,
            fast_market_order_vaa_digest.as_ref(),
            fast_market_order.close_account_refund_recipient.as_ref(),
        ],
        &program_id,
    );

    if fast_market_order_pda != fast_market_order_key {
        msg!("Fast market order pda is invalid");
        return Err(MatchingEngineError::InvalidPda.into())
            .map_err(|e: Error| e.with_pubkeys((fast_market_order_key, fast_market_order_pda)));
    }
    let fast_market_order_seeds = [
        FastMarketOrderState::SEED_PREFIX,
        fast_market_order_vaa_digest.as_ref(),
        fast_market_order.close_account_refund_recipient.as_ref(),
        &[fast_market_order_bump],
    ];
    let fast_market_order_signer_seeds = &[&fast_market_order_seeds[..]];
    // Create the account using the system program. The create account reliably ensures that the account creation cannot be raced.
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
    if fast_market_order_account_data.len() < 8_usize.saturating_add(fast_market_order_bytes.len())
    {
        msg!("Account data buffer too small");
        return Err(MatchingEngineError::AccountDataTooSmall.into());
    }
    // Write the fast_market_order struct to the account
    fast_market_order_account_data[8..8_usize.saturating_add(fast_market_order_bytes.len())]
        .copy_from_slice(fast_market_order_bytes);
    // End of fast market order account creation
    // ------------------------------------------------------------------------------------------------

    Ok(())
}
