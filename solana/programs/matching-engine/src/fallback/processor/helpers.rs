use anchor_lang::prelude::*;

use anchor_spl::token::spl_token;
use solana_program::{
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed_unchecked,
    system_instruction,
};

#[inline(always)]
pub fn check_account_length(accounts: &[AccountInfo], len: usize) -> Result<()> {
    if accounts.len() < len {
        return Err(ErrorCode::AccountNotEnoughKeys.into());
    }
    Ok(())
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

/// Create a token account reliably
///
/// This function creates a token account and initializes it with the given mint and owner.
///
/// # Arguments
///
/// * `payer_pubkey` - The pubkey of the account that will pay for the token account.
/// * `account_pubkey_to_create` - The pubkey of the account to create.
/// * `owner_account_info` - The account info of the owner of the token account.
/// * `mint_pubkey` - The pubkey of the mint.
/// * `data_len` - The length of the data to be written to the token account.
/// * `accounts` - The accounts to be used in the CPI.
/// * `signer_seeds` - The signer seeds to be used in the CPI.
#[allow(clippy::too_many_arguments)]
pub fn create_token_account_reliably(
    payer_pubkey: &Pubkey,
    account_pubkey_to_create: &Pubkey,
    owner_account_pubkey: &Pubkey,
    mint_pubkey: &Pubkey,
    data_len: usize,
    token_account_lamports: u64,
    accounts: &[AccountInfo],
    signer_seeds: &[&[&[u8]]],
) -> ProgramResult {
    // Create the owner account
    create_account_reliably(
        payer_pubkey,
        account_pubkey_to_create,
        token_account_lamports,
        data_len,
        accounts,
        &spl_token::ID,
        signer_seeds,
    )?;

    // Create the token account
    let init_token_account_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        account_pubkey_to_create,
        mint_pubkey,
        owner_account_pubkey,
    )?;

    solana_program::program::invoke_signed_unchecked(&init_token_account_ix, accounts, &[])?;

    Ok(())
}
