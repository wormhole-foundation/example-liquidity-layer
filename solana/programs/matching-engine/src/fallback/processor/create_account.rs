use anchor_lang::prelude::*;
use solana_program::{
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed_unchecked,
    system_instruction,
};
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
            data_len as u64,
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
            cpi_data[4..12].copy_from_slice(&(data_len as u64).to_le_bytes());

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
