use anchor_lang::prelude::*;
use anchor_lang::{InstructionData, ToAccountMetas};

pub fn transfer_ownership(
    program_id: Pubkey,
    custodian: Pubkey,
    cctp_mint_recipient: Pubkey,
    mint: Pubkey,
) -> Instruction {
    // TODO: Implement this
}

fn create_submit_ownership_transfer_ix(
    program_id: Pubkey,
    custodian: Pubkey,
    sender: Pubkey,
    new_owner: Pubkey,
) -> Instruction {

    let accounts = matching_engine::accounts::SubmitOwnershipTransferRequest {
        admin: sender,
        new_owner,
    };

    let ix_data = matching_engine::instruction::SubmitOwnershipTransferRequest{}.data();
    
    Instruction {
        program_id,
        accounts: accounts.to_account_metas(None),
        data: ix_data,
    }
}