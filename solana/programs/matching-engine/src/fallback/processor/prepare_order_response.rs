use std::io::Cursor;

use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use solana_program::program_pack::Pack;
use common::messages::raw::SlowOrderResponse;
use common::wormhole_cctp_solana::cpi::ReceiveMessageArgs;
use common::wormhole_cctp_solana::utils::CctpMessage;
use solana_program::program::invoke_signed_unchecked;
use super::create_account::create_account_reliably;
use solana_program::instruction::Instruction;
use crate::state::PreparedOrderResponseInfo;
use crate::state::PreparedOrderResponseSeeds;
use crate::state::{Custodian, FastMarketOrder as FastMarketOrderState, MessageProtocol, PreparedOrderResponse, RouterEndpoint};
use common::wormhole_cctp_solana::cctp::message_transmitter_program;

use super::errors::FallbackError;
use crate::error::MatchingEngineError;


#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct PrepareOrderResponseCctpShimData {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message: FinalizedVaaMessage,
}

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct FinalizedVaaMessage {
    pub vaa_sequence: u64,
    pub vaa_timestamp: u32,
    pub vaa_emitter_chain: u16,
    pub vaa_emitter_address: [u8; 32],
    pub base_fee: u64,
    pub deposit_message: DepositMessage,
    pub guardian_set_bump: u8,
}

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct DepositMessage {
    pub token_address: [u8; 32],
    pub amount: [u8; 32], // little endian
    pub source_cctp_domain: u32,
    pub destination_cctp_domain: u32,
    pub cctp_nonce: u64,
    pub burn_source: [u8; 32],
    pub mint_recipient: [u8; 32],
    pub digest: [u8; 32],
    pub payload_len: u16,
    pub payload: Vec<u8>,
}

impl PrepareOrderResponseCctpShimData {
    pub fn new(encoded_cctp_message: Vec<u8>, cctp_attestation: Vec<u8>, finalized_vaa_message: FinalizedVaaMessage) -> Self {
        Self { encoded_cctp_message, cctp_attestation, finalized_vaa_message }
    }
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        Self::try_from_slice(data).ok()
    }
    pub fn to_bytes(&self) -> Vec<u8> {
        self.try_to_vec().unwrap()
    }

    pub fn to_receive_message_args(&self) -> ReceiveMessageArgs {
        let mut encoded_message = Vec::with_capacity(self.encoded_cctp_message.len());
        encoded_message.extend_from_slice(&self.encoded_cctp_message);
        let mut cctp_attestation = Vec::with_capacity(self.cctp_attestation.len());
        cctp_attestation.extend_from_slice(&self.cctp_attestation);
        ReceiveMessageArgs { encoded_message, attestation: cctp_attestation }
    }
}

pub struct PrepareOrderResponseCctpShimAccounts<'ix> {
    pub signer: &'ix Pubkey,
    pub custodian: &'ix Pubkey,
    pub fast_market_order: &'ix Pubkey,
    pub from_endpoint: &'ix Pubkey,
    pub to_endpoint: &'ix Pubkey,
    pub prepared_order_response: &'ix Pubkey,
    pub prepared_custody_token: &'ix Pubkey,
    pub base_fee_token: &'ix Pubkey,
    pub usdc: &'ix Pubkey,
    pub cctp_mint_recipient: &'ix Pubkey,
    pub cctp_message_transmitter_authority: &'ix Pubkey,
    pub cctp_message_transmitter_config: &'ix Pubkey,
    pub cctp_used_nonces: &'ix Pubkey,
    pub cctp_message_transmitter_event_authority: &'ix Pubkey,
    pub cctp_token_messenger: &'ix Pubkey,
    pub cctp_remote_token_messenger: &'ix Pubkey,
    pub cctp_token_minter: &'ix Pubkey,
    pub cctp_local_token: &'ix Pubkey,
    pub cctp_token_pair: &'ix Pubkey,
    pub cctp_token_messenger_minter_custody_token: &'ix Pubkey,
    pub cctp_token_messenger_minter_event_authority: &'ix Pubkey,
    pub cctp_token_messenger_minter_program: &'ix Pubkey,
    pub cctp_message_transmitter_program: &'ix Pubkey,
    pub guardian_set: &'ix Pubkey,
    pub guardian_set_signatures: &'ix Pubkey,
    pub verify_shim_program: &'ix Pubkey,
    pub token_program: &'ix Pubkey,
    pub system_program: &'ix Pubkey,
}

impl<'ix> PrepareOrderResponseCctpShimAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.signer, false),
            AccountMeta::new_readonly(*self.custodian, false),
            AccountMeta::new_readonly(*self.fast_market_order, false),
            AccountMeta::new_readonly(*self.from_endpoint, false),
            AccountMeta::new_readonly(*self.to_endpoint, false),
            AccountMeta::new_readonly(*self.prepared_order_response, false),
            AccountMeta::new_readonly(*self.prepared_custody_token, false),
            AccountMeta::new_readonly(*self.base_fee_token, false),
            AccountMeta::new_readonly(*self.usdc, false),
            AccountMeta::new_readonly(*self.cctp_mint_recipient, false),
            AccountMeta::new_readonly(*self.cctp_message_transmitter_authority, false),
            AccountMeta::new_readonly(*self.cctp_message_transmitter_config, false),
            AccountMeta::new(*self.cctp_used_nonces, false),
            AccountMeta::new_readonly(*self.cctp_message_transmitter_event_authority, false),
            AccountMeta::new_readonly(*self.cctp_token_messenger, false),
            AccountMeta::new_readonly(*self.cctp_remote_token_messenger, false),
            AccountMeta::new_readonly(*self.cctp_token_minter, false),
            AccountMeta::new(*self.cctp_local_token, false),
            AccountMeta::new_readonly(*self.cctp_token_pair, false),
            AccountMeta::new(*self.cctp_token_messenger_minter_custody_token, false),
            AccountMeta::new_readonly(*self.cctp_token_messenger_minter_event_authority, false),
            AccountMeta::new_readonly(*self.cctp_token_messenger_minter_program, false),
            AccountMeta::new_readonly(*self.cctp_message_transmitter_program, false),
            AccountMeta::new_readonly(*self.guardian_set, false),
            AccountMeta::new_readonly(*self.guardian_set_signatures, false),
            AccountMeta::new_readonly(*self.verify_shim_program, false),
            AccountMeta::new_readonly(*self.token_program, false),
            AccountMeta::new_readonly(*self.system_program, false),
        ]
    }
}

pub struct PrepareOrderResponseCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: PrepareOrderResponseCctpShimAccounts<'ix>,
    pub data: PrepareOrderResponseCctpShimData,
}

impl<'ix> PrepareOrderResponseCctpShim<'ix> {
    pub fn instruction(&self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: self.data.to_bytes(),
        }
    }
}

pub fn prepare_order_response_cctp_shim(accounts: &[AccountInfo], data: PrepareOrderResponseCctpShimData) -> Result<()> {
    let program_id = &crate::ID;
    if accounts.len() < 27 {
        return Err(ErrorCode::AccountNotEnoughKeys.into());
    }
    let signer = &accounts[0];
    let custodian = &accounts[1];
    let fast_market_order = &accounts[2];
    let from_endpoint = &accounts[3];
    let to_endpoint = &accounts[4];
    let prepared_order_response = &accounts[5];
    let prepared_custody_token = &accounts[6];
    let base_fee_token = &accounts[7];
    let usdc = &accounts[8];
    let cctp_mint_recipient = &accounts[9];
    let cctp_message_transmitter_authority = &accounts[10];
    let cctp_message_transmitter_config = &accounts[11];
    let cctp_used_nonces = &accounts[12];
    let cctp_message_transmitter_event_authority = &accounts[13];
    let cctp_token_messenger = &accounts[14];
    let cctp_remote_token_messenger = &accounts[15];
    let cctp_token_minter = &accounts[16];
    let cctp_local_token = &accounts[17];
    let cctp_token_pair = &accounts[18];
    let cctp_token_messenger_minter_custody_token = &accounts[19];
    let cctp_token_messenger_minter_event_authority = &accounts[20];
    let cctp_token_messenger_minter_program = &accounts[21];
    let cctp_message_transmitter_program = &accounts[22];
    let guardian_set = &accounts[23];
    let guardian_set_signatures = &accounts[24];
    let _verify_shim_program = &accounts[25];    
    let token_program = &accounts[26];
    let system_program = &accounts[27];

    let receive_message_args = data.to_receive_message_args();
    let finalized_vaa_message = data.finalized_vaa_message;
    let deposit_message = finalized_vaa_message.deposit_message;
    
    // Check that fast market order is owned by the program
    if fast_market_order.owner != program_id {
        msg!("Fast market order owner is invalid: expected {}, got {}", program_id, fast_market_order.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }
    
    // Load accounts
    let fast_market_order_zero_copy = FastMarketOrderState::try_deserialize(&mut &fast_market_order.data.borrow()[..])?;
    // Load from cctp message.
    let cctp_message = CctpMessage::parse(&data.encoded_cctp_message).map_err(|_| FallbackError::InvalidCctpMessage)?;

    let checked_custodian = Custodian::try_deserialize(&mut &custodian.data.borrow()[..])?;
    // Deserialise the to_endpoint account
    let to_endpoint_account = RouterEndpoint::try_deserialize(&mut &to_endpoint.data.borrow()[..])?;
    // Deserialise the from_endpoint account
    let from_endpoint_account = RouterEndpoint::try_deserialize(&mut &from_endpoint.data.borrow()[..])?;

    let guardian_set_bump = finalized_vaa_message.guardian_set_bump;

    // Check loaded vaa is deposit message
    let slow_order_response = SlowOrderResponse::parse(&deposit_message.payload).map_err(|_| MatchingEngineError::InvalidDepositPayloadId)?;

    // Create pdas for addresses that need to be created
    // Check the prepared order response account is valid
    let prepared_order_response_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        &fast_market_order_zero_copy.digest
    ];

    let (prepared_order_response_pda, prepared_order_response_bump) = Pubkey::find_program_address(&prepared_order_response_seeds, program_id);

    let prepared_custody_token_seeds = [
        crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
    ];

    let (prepared_custody_token_pda, prepared_custody_token_bump) = Pubkey::find_program_address(&prepared_custody_token_seeds, program_id);

    // Check custodian account
    if custodian.owner != program_id {
        msg!("Custodian owner is invalid: expected {}, got {}", program_id, custodian.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("custodian"));
    }
    
    if checked_custodian.paused {
        msg!("Custodian is paused");
        return Err(ErrorCode::ConstraintRaw.into())
            .map_err(|e: Error| e.with_account_name("custodian"));
    }

    // Check usdc mint
    if usdc.key() != common::USDC_MINT {
        msg!("Usdc mint is invalid");
        return Err(FallbackError::InvalidMint.into());
    }
    
    // Check from_endpoint owner
    if from_endpoint.owner != program_id {
        msg!("From endpoint owner is invalid: expected {}, got {}", program_id, from_endpoint.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("from_endpoint"));
    }
    
    // Check to_endpoint owner
    if to_endpoint.owner != program_id {
        msg!("To endpoint owner is invalid: expected {}, got {}", program_id, to_endpoint.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("to_endpoint"));
    }
    
    
    // Check that the from and to endpoints are different
    if from_endpoint_account.chain == to_endpoint_account.chain {
        return Err(MatchingEngineError::SameEndpoint.into());
    }
    
    // Check that the to endpoint protocol is cctp or local
    match to_endpoint_account.protocol {
        MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
        _ => return Err(MatchingEngineError::InvalidEndpoint.into()),
    }
    
    // Check that the from endpoint protocol is cctp or local
    match from_endpoint_account.protocol {
        MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
        _ => return Err(MatchingEngineError::InvalidEndpoint.into()),
    }

    // Check that to endpoint chain is equal to the fast_market_order target_chain
    if to_endpoint_account.chain != fast_market_order_zero_copy.target_chain {
        msg!("To endpoint chain is not equal to the fast_market_order target_chain");
        return Err(MatchingEngineError::InvalidTargetRouter.into());
    }

    if prepared_order_response_pda != prepared_order_response.key() {
        msg!("Prepared order response pda is invalid");
        return Err(FallbackError::InvalidPda.into())
            .map_err(|e: Error| e.with_pubkeys((prepared_order_response_pda, prepared_order_response.key())));
    }

    if prepared_custody_token_pda != prepared_custody_token.key() {
        msg!("Prepared custody token pda is invalid");
        return Err(FallbackError::InvalidPda.into())
            .map_err(|e: Error| e.with_pubkeys((prepared_custody_token_pda, prepared_custody_token.key())));
    }
    
    // Check vaa emitter chain matches fast market order emitter chain
    if fast_market_order_zero_copy.vaa_emitter_chain != finalized_vaa_message.vaa_emitter_chain {
        msg!("Vaa emitter chain does not match fast market order emitter chain");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }
    // TODO: Figure out how to find emitter address to check against

    // Check vaa emitter address matches fast market order emitter address
    if fast_market_order_zero_copy.vaa_emitter_address != finalized_vaa_message.vaa_emitter_address {
        msg!("Vaa emitter address does not match fast market order emitter address");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    // TODO: Figure out how to check the sequence number
    if fast_market_order_zero_copy.vaa_sequence != finalized_vaa_message.vaa_sequence.saturating_add(1) {
        msg!("Vaa sequence must be exactly 1 greater than fast market order sequence");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    // TODO: Figure out how to check the timestamp
    if fast_market_order_zero_copy.vaa_timestamp != finalized_vaa_message.vaa_timestamp {
        msg!("Vaa timestamp does not match fast market order timestamp");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    // TODO: Make checks against cctp message
    if cctp_message.sender() != fast_market_order_zero_copy.sender {
        msg!("Cctp message sender does not match fast market order sender");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    if cctp_message.destination_domain() != deposit_message.destination_cctp_domain {
        msg!("Cctp message destination domain does not match deposit message destination domain");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    if cctp_message.nonce() != deposit_message.cctp_nonce {
        msg!("Cctp message nonce does not match deposit message nonce");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    if cctp_message.source_domain() != deposit_message.source_cctp_domain {
        msg!("Cctp message source domain does not match deposit message source domain");
        return Err(MatchingEngineError::VaaMismatch.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    }

    // Check the base token fee key is not equal to the prepared custody token key
    if base_fee_token.key() == prepared_custody_token.key() {
        msg!("Base token fee key is equal to the prepared custody token key");
        return Err(MatchingEngineError::InvalidBaseFeeToken.into())
            .map_err(|e: Error| e.with_account_name("base_fee_token"));
    }

    if token_program.key() != spl_token::ID {
        msg!("Token program is invalid");
        return Err(FallbackError::InvalidProgram.into())
            .map_err(|e: Error| e.with_account_name("token_program"));
    }

    if _verify_shim_program.key() != wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID {
        msg!("Verify shim program is invalid");
        return Err(FallbackError::InvalidProgram.into())
            .map_err(|e: Error| e.with_account_name("verify_shim_program"));
    }

    if system_program.key() != solana_program::system_program::ID {
        msg!("System program is invalid");
        return Err(FallbackError::InvalidProgram.into())
            .map_err(|e: Error| e.with_account_name("system_program"));
    }

    // Verify deposit message shim using verify shim program

    // Start verify deposit message vaa shim
    // ------------------------------------------------------------------------------------------------
    let verify_hash_data = {
        let mut data = vec![];
        data.extend_from_slice(&wormhole_svm_shim::verify_vaa::VerifyVaaShimInstruction::<false>::VERIFY_HASH_SELECTOR);
        data.push(guardian_set_bump);
        data.extend_from_slice(&fast_market_order_zero_copy.digest);
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
    invoke_signed_unchecked(&verify_shim_ix, &[
        guardian_set.to_account_info(),
        guardian_set_signatures.to_account_info(),
    ], &[])?;
    // End verify deposit message vaa shim
    // ------------------------------------------------------------------------------------------------

    // Start create prepared order response account
    // ------------------------------------------------------------------------------------------------

    // Write to the prepared slow order account, which will be closed by one of the following
    // instructions:
    // * settle_auction_active_cctp
    // * settle_auction_complete
    // * settle_auction_none
    let create_prepared_order_respone_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        &fast_market_order_zero_copy.digest,
        &[prepared_order_response_bump],
    ];
    let prepared_order_response_signer_seeds = &[&create_prepared_order_respone_seeds[..]];
    let prepared_order_response_account_space = PreparedOrderResponse::compute_size(fast_market_order_zero_copy.redeemer_message_length.into());

    create_account_reliably(
        &signer.key(),
        &prepared_order_response.key(),
        prepared_order_response.lamports(),
        prepared_order_response_account_space,
        accounts,
        program_id,
        prepared_order_response_signer_seeds,
    )?;

    // Write the prepared order response account data ...
    let prepared_order_response_account_to_write = PreparedOrderResponse {
        seeds: PreparedOrderResponseSeeds {
            fast_vaa_hash: fast_market_order_zero_copy.digest,
            bump: prepared_order_response_bump,
        },
        info: PreparedOrderResponseInfo {
            prepared_by: signer.key(),
            base_fee_token: base_fee_token.key(),
            source_chain: fast_market_order_zero_copy.vaa_emitter_chain,
            base_fee: slow_order_response.base_fee(),
            fast_vaa_timestamp: fast_market_order_zero_copy.vaa_timestamp,
            amount_in: fast_market_order_zero_copy.amount_in,
            sender: fast_market_order_zero_copy.sender,
            redeemer: fast_market_order_zero_copy.redeemer,
            init_auction_fee: fast_market_order_zero_copy.init_auction_fee,
        },
        to_endpoint: to_endpoint_account.info,
        redeemer_message: fast_market_order_zero_copy.redeemer_message[..fast_market_order_zero_copy.redeemer_message_length as usize].to_vec(),
    };
    // Use cursor in order to write the prepared order response account data
    let prepared_order_response_data: &mut [u8] = &mut prepared_order_response.try_borrow_mut_data().map_err(|_| FallbackError::AccountNotWritable)?;
    let mut cursor = Cursor::new(prepared_order_response_data);
    prepared_order_response_account_to_write.try_serialize(&mut cursor).map_err(|_| FallbackError::BorshDeserializationError)?;

    // End create prepared order response account
    // ------------------------------------------------------------------------------------------------

    // Start create prepared custody token account
    // ------------------------------------------------------------------------------------------------
    let create_prepared_custody_token_seeds = [
        crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
        &[prepared_custody_token_bump],
    ];

    let prepared_custody_token_signer_seeds = &[&create_prepared_custody_token_seeds[..]];
    let prepared_custody_token_account_space = spl_token::state::Account::LEN;
    create_account_reliably(
        &signer.key(),
        &prepared_custody_token_pda,
        prepared_custody_token.lamports(),
        prepared_custody_token_account_space,
        accounts,
        program_id,
        prepared_custody_token_signer_seeds,
    )?;
    let init_token_account_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        &prepared_custody_token_pda,
        &usdc.key(),
        &prepared_custody_token.key(),
    ).unwrap();

    solana_program::program::invoke(
        &init_token_account_ix,
        accounts,
    ).unwrap();

    // End create prepared custody token account
    // ------------------------------------------------------------------------------------------------

    // Create cpi context for verify_vaa_and_mint
    message_transmitter_program::cpi::receive_token_messenger_minter_message(
        CpiContext::new_with_signer(
            cctp_message_transmitter_program.to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: signer.to_account_info(),
                caller: custodian.to_account_info(),
                message_transmitter_authority: cctp_message_transmitter_authority.to_account_info(),
                message_transmitter_config: cctp_message_transmitter_config.to_account_info(),
                used_nonces: cctp_used_nonces.to_account_info(),
                token_messenger_minter_program: cctp_token_messenger_minter_program.to_account_info(),
                system_program: system_program.to_account_info(),
                message_transmitter_event_authority: cctp_message_transmitter_event_authority.to_account_info(),
                message_transmitter_program: cctp_message_transmitter_program.to_account_info(),
                token_messenger: cctp_token_messenger.to_account_info(),
                remote_token_messenger: cctp_remote_token_messenger.to_account_info(),
                token_minter: cctp_token_minter.to_account_info(),
                local_token: cctp_local_token.to_account_info(),
                token_pair: cctp_token_pair.to_account_info(),
                mint_recipient: cctp_mint_recipient.to_account_info(),
                custody_token: cctp_token_messenger_minter_custody_token.to_account_info(),
                token_program: token_program.to_account_info(),
                token_messenger_minter_event_authority: cctp_token_messenger_minter_event_authority.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        receive_message_args,
    )?;
    
    // Finally transfer minted via CCTP to prepared custody token.
    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        &cctp_mint_recipient.key(),
        &prepared_custody_token.key(),
        &cctp_message_transmitter_authority.key(),
        &[], // Apparently this is only for multi-sig accounts
        fast_market_order_zero_copy.amount_in,
    ).unwrap();

    invoke_signed_unchecked(&transfer_ix, accounts, &[
        Custodian::SIGNER_SEEDS,
    ]).map_err(|_| FallbackError::TokenTransferFailed)?;

    Ok(())
}


