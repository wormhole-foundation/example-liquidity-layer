use std::cell::Ref;

use anchor_lang::{prelude::*, Discriminator};
use anchor_spl::token::spl_token;
use solana_program::{
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    keccak,
    program::invoke_signed_unchecked,
    program_pack::Pack,
    system_instruction,
};
use wormhole_svm_shim::verify_vaa;

use crate::{
    error::MatchingEngineError,
    state::{AuctionConfig, Custodian, FastMarketOrder, MessageProtocol, RouterEndpoint},
    ID,
};

#[inline(always)]
pub fn require_min_account_infos_len(accounts: &[AccountInfo], at_least_len: usize) -> Result<()> {
    if accounts.len() < at_least_len {
        return Err(ErrorCode::AccountNotEnoughKeys.into());
    }

    Ok(())
}

#[inline(always)]
pub fn require_owned_by_this_program(account: &AccountInfo, account_name: &str) -> Result<()> {
    if account.owner != &ID {
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name(account_name));
    }

    Ok(())
}

#[inline(always)]
pub fn try_custodian_account(
    custodian_info: &AccountInfo,
    check_if_paused: bool,
) -> Result<Box<Custodian>> {
    super::helpers::require_owned_by_this_program(custodian_info, "custodian")?;

    let custodian =
        Custodian::try_deserialize(&mut &custodian_info.data.borrow()[..]).map(Box::new)?;

    // Make sure the custodian is not paused.
    if check_if_paused && custodian.paused {
        return Err(MatchingEngineError::Paused.into());
    }

    Ok(custodian)
}

#[inline(always)]
pub fn try_auction_config_account(
    auction_config_info: &AccountInfo,
    expected_config_id: Option<u32>,
) -> Result<Box<AuctionConfig>> {
    super::helpers::require_owned_by_this_program(auction_config_info, "auction_config")?;

    let auction_config =
        AuctionConfig::try_deserialize(&mut &auction_config_info.data.borrow()[..])
            .map(Box::new)?;

    // Make sure the custodian is not paused.
    if let Some(expected_config_id) = expected_config_id {
        if auction_config.id != expected_config_id {
            msg!("Auction config id is invalid");
            return Err(ErrorCode::ConstraintRaw.into())
                .map_err(|e: Error| e.with_account_name("auction_config"));
        }
    }

    Ok(auction_config)
}

#[inline(always)]
pub fn try_live_endpoint_account(
    endpoint_info: &AccountInfo,
    endpoint_name: &str,
) -> Result<Box<RouterEndpoint>> {
    super::helpers::require_owned_by_this_program(endpoint_info, endpoint_name)?;

    let endpoint =
        RouterEndpoint::try_deserialize(&mut &endpoint_info.data.borrow()[..]).map(Box::new)?;

    if endpoint.protocol == MessageProtocol::None {
        return Err(MatchingEngineError::EndpointDisabled.into());
    }

    Ok(endpoint)
}

#[inline(always)]
pub fn try_live_endpoint_accounts_path(
    from_endpoint_info: &AccountInfo,
    to_endpoint_info: &AccountInfo,
) -> Result<(Box<RouterEndpoint>, Box<RouterEndpoint>)> {
    let from_endpoint = try_live_endpoint_account(from_endpoint_info, "from_endpoint")?;
    let to_endpoint = try_live_endpoint_account(to_endpoint_info, "to_endpoint")?;

    if from_endpoint.chain == to_endpoint.chain {
        return Err(MatchingEngineError::SameEndpoint.into());
    }

    Ok((from_endpoint, to_endpoint))
}

pub fn try_usdc_account<'a, 'b>(usdc_info: &'a AccountInfo<'b>) -> Result<&'a AccountInfo<'b>> {
    if usdc_info.key != &common::USDC_MINT {
        return Err(MatchingEngineError::InvalidMint.into())
            .map_err(|e: Error| e.with_account_name("usdc"));
    }

    Ok(usdc_info)
}

/// Read from an account info
pub fn try_fast_market_order_account<'a>(
    fast_market_order_info: &'a AccountInfo,
) -> Result<Ref<'a, FastMarketOrder>> {
    let data = fast_market_order_info.data.borrow();

    if data.len() < 8 {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    if &data[0..8] != &FastMarketOrder::DISCRIMINATOR {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    // TODO: Move up?
    super::helpers::require_owned_by_this_program(fast_market_order_info, "fast_market_order")?;

    Ok(Ref::map(data, |data| {
        bytemuck::from_bytes(&data[8..8 + std::mem::size_of::<FastMarketOrder>()])
    }))
}

pub fn invoke_verify_hash(
    verify_vaa_shim_program_index: usize,
    wormhole_guardian_set_index: usize,
    shim_guardian_signatures_index: usize,
    guardian_set_bump: u8,
    vaa_message_digest: keccak::Hash,
    accounts: &[AccountInfo],
) -> Result<()> {
    if accounts[verify_vaa_shim_program_index].key
        != &wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID
    {
        return Err(ErrorCode::ConstraintAddress.into())
            .map_err(|e: Error| e.with_account_name("verify_vaa_shim_program"));
    }

    let verify_hash_ix = verify_vaa::VerifyHash {
        program_id: &wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
        accounts: verify_vaa::VerifyHashAccounts {
            guardian_set: accounts[wormhole_guardian_set_index].key,
            guardian_signatures: accounts[shim_guardian_signatures_index].key,
        },
        data: verify_vaa::VerifyHashData::new(guardian_set_bump, vaa_message_digest),
    }
    .instruction();

    invoke_signed_unchecked(&verify_hash_ix, accounts, &[]).map_err(Into::into)
}

pub fn create_account_reliably(
    payer_key: &Pubkey,
    account_key: &Pubkey,
    current_lamports: u64,
    data_len: usize,
    accounts: &[AccountInfo],
    program_id: &Pubkey,
    signer_seeds: &[&[&[u8]]],
) -> ProgramResult {
    let lamports = Rent::get().unwrap().minimum_balance(data_len);

    if current_lamports == 0 {
        let ix = system_instruction::create_account(
            payer_key,
            account_key,
            lamports,
            u64::try_from(data_len).unwrap(), // lol it won't do ::from
            program_id,
        );

        invoke_signed_unchecked(&ix, accounts, signer_seeds)?;
    } else {
        const MAX_CPI_DATA_LEN: usize = 36;

        // Perform up to three CPIs:
        // 1. Transfer lamports from payer to account (may not be necessary).
        // 2. Allocate data to the account.
        // 3. Assign the account owner to this program.
        //
        // The max length of instruction data is 36 bytes among the three
        // instructions, so we will reuse the same allocated memory for all.
        let mut cpi_ix = Instruction {
            program_id: solana_program::system_program::ID,
            accounts: vec![
                AccountMeta::new(*payer_key, true),
                AccountMeta::new(*account_key, true),
            ],
            data: Vec::with_capacity(MAX_CPI_DATA_LEN),
        };

        // Safety: Because capacity is > 12, it is safe to set this length.
        unsafe {
            cpi_ix.data.set_len(12);
        }

        // We will have to transfer the remaining lamports needed to cover rent
        // for the account.
        let lamport_diff = lamports.saturating_sub(current_lamports);

        // Only invoke transfer if there are lamports required.
        if lamport_diff != 0 {
            let cpi_data = &mut cpi_ix.data;

            // Safety: Because the capacity is > 4, it is safe to write to the
            // first 4 elements, which covers the System program instruction
            // selectors.
            //
            // The transfer and allocate instructions are 12 bytes long:
            // - 4 bytes for the discriminator
            // - 8 bytes for the lamports (transfer) or data length (allocate)
            //
            // The last 8 bytes will be copied to the data slice.
            unsafe {
                core::ptr::write_bytes(cpi_data.as_mut_ptr(), 0, 4);
            }
            cpi_data[0] = 2; // transfer selector
            cpi_data[4..12].copy_from_slice(&lamport_diff.to_le_bytes());

            invoke_signed_unchecked(&cpi_ix, accounts, signer_seeds)?;
        }

        let cpi_accounts = &mut cpi_ix.accounts;

        // Safety: Setting the length reduces the previous length from the last
        // CPI call.
        //
        // Both allocate and assign instructions require one account (the
        // account being created).
        unsafe {
            cpi_accounts.set_len(1);
        }

        // Because the payer and account are writable signers, we can simply
        // overwrite the pubkey of the first account.
        cpi_accounts[0].pubkey = *account_key;

        {
            let cpi_data = &mut cpi_ix.data;

            cpi_data[0] = 8; // allocate selector
            cpi_data[4..12].copy_from_slice(&u64::try_from(data_len).unwrap().to_le_bytes());
            //                                         ↑
            //                              It won't do ::from but it'll do ::try_from
            invoke_signed_unchecked(&cpi_ix, accounts, signer_seeds)?;
        }

        {
            let cpi_data = &mut cpi_ix.data;

            // Safety: The capacity of this vector is 36. This data will be
            // overwritten for the next CPI call.
            unsafe {
                cpi_data.set_len(MAX_CPI_DATA_LEN);
            }

            cpi_data[0] = 1; // assign selector
            cpi_data[4..36].copy_from_slice(&program_id.to_bytes());

            invoke_signed_unchecked(&cpi_ix, accounts, signer_seeds)?;
        }
    }

    Ok(())
}

/// Create a USDC token account reliably.
///
/// This function creates a USDC token account and initializes it with the given owner.
///
/// # Arguments
///
/// * `payer_key` - The pubkey of the account that will pay for the token account.
/// * `token_account_key` - The pubkey of the account to create.
/// * `token_account_owner_key` - The account info of the owner of the token account.
/// * `token_account_lamports` - Current lamports on token account.
/// * `accounts` - The accounts to be used in the CPI.
/// * `signer_seeds` - The signer seeds to be used in the CPI.
pub fn create_usdc_token_account_reliably(
    payer_key: &Pubkey,
    token_account_key: &Pubkey,
    token_account_owner_key: &Pubkey,
    token_account_lamports: u64,
    accounts: &[AccountInfo],
    signer_seeds: &[&[&[u8]]],
) -> ProgramResult {
    create_account_reliably(
        payer_key,
        token_account_key,
        token_account_lamports,
        spl_token::state::Account::LEN,
        accounts,
        &spl_token::ID,
        signer_seeds,
    )?;

    let init_token_account_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        token_account_key,
        &common::USDC_MINT,
        token_account_owner_key,
    )
    .unwrap();

    solana_program::program::invoke_signed_unchecked(&init_token_account_ix, accounts, &[])
}

/// VaaMessageBodyHeader for the digest calculation
///
/// This is the header of the vaa message body. It is used to calculate the
/// digest of the fast market order.
#[derive(Debug)]
pub struct VaaMessageBodyHeader {
    pub consistency_level: u8,
    pub timestamp: u32,
    pub sequence: u64,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
}

impl VaaMessageBodyHeader {
    // TODO: Remove
    pub fn new(
        consistency_level: u8,
        timestamp: u32,
        sequence: u64,
        emitter_chain: u16,
        emitter_address: [u8; 32],
    ) -> Self {
        Self {
            consistency_level,
            timestamp,
            sequence,
            emitter_chain,
            emitter_address,
        }
    }

    /// This function creates both the message body for the fast market order, including the payload.
    pub fn message_body(&self, fast_market_order: &FastMarketOrder) -> Vec<u8> {
        let mut message_body = vec![];
        message_body.extend_from_slice(&self.timestamp.to_be_bytes());
        message_body.extend_from_slice(&[0, 0, 0, 0]); // 0 nonce
        message_body.extend_from_slice(&self.emitter_chain.to_be_bytes());
        message_body.extend_from_slice(&self.emitter_address);
        message_body.extend_from_slice(&self.sequence.to_be_bytes());
        message_body.extend_from_slice(&[self.consistency_level]);
        message_body.push(11_u8);
        message_body.extend_from_slice(&fast_market_order.amount_in.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.min_amount_out.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.target_chain.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.redeemer);
        message_body.extend_from_slice(&fast_market_order.sender);
        message_body.extend_from_slice(&fast_market_order.refund_address);
        message_body.extend_from_slice(&fast_market_order.max_fee.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.init_auction_fee.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.deadline.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.redeemer_message_length.to_be_bytes());
        if fast_market_order.redeemer_message_length > 0 {
            message_body.extend_from_slice(
                &fast_market_order.redeemer_message
                    [..usize::from(fast_market_order.redeemer_message_length)],
            );
        }
        message_body
    }

    /// The digest is the hash of the message hash.
    pub fn digest(&self, fast_market_order: &FastMarketOrder) -> keccak::Hash {
        wormhole_svm_definitions::compute_keccak_digest(
            keccak::hashv(&[&self.message_body(fast_market_order)]),
            None,
        )
    }
}
