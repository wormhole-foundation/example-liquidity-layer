use std::io::Cursor;

use super::helpers::create_account_reliably;
use super::FallbackMatchingEngineInstruction;
use crate::fallback::helpers::check_account_length;
use crate::state::PreparedOrderResponseInfo;
use crate::state::PreparedOrderResponseSeeds;
use crate::state::{
    Custodian, FastMarketOrder as FastMarketOrderState, MessageProtocol, PreparedOrderResponse,
    RouterEndpoint,
};
use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use common::messages::raw::LiquidityLayerDepositMessage;
use common::messages::raw::LiquidityLayerMessage;
use common::messages::raw::SlowOrderResponse;
use common::wormhole_cctp_solana::cctp::message_transmitter_program;
use common::wormhole_cctp_solana::cpi::ReceiveMessageArgs;
use common::wormhole_cctp_solana::utils::CctpMessage;
use solana_program::instruction::Instruction;
use solana_program::keccak;
use solana_program::program::invoke_signed_unchecked;
use solana_program::program_pack::Pack;

use crate::error::MatchingEngineError;

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct PrepareOrderResponseCctpShimData {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message: FinalizedVaaMessage,
}

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct FinalizedVaaMessage {
    pub base_fee: u64,            // Can also get from deposit payload
    pub vaa_payload: Vec<u8>,     // Can get a lot of this info from the cctp message
    pub deposit_payload: Vec<u8>, // Probably dont need this since its in the vaa payload (at the end)
    pub guardian_set_bump: u8,
}

impl FinalizedVaaMessage {
    pub fn digest(
        &self,
        sequence: u64,
        timestamp: u32,
        emitter_chain: u16,
        emitter_address: [u8; 32],
        nonce: u32,
        consistency_level: u8,
    ) -> [u8; 32] {
        let message_hash = keccak::hashv(&[
            timestamp.to_be_bytes().as_ref(),
            nonce.to_be_bytes().as_ref(),
            emitter_chain.to_be_bytes().as_ref(),
            &emitter_address,
            &sequence.to_be_bytes(),
            &[consistency_level],
            self.vaa_payload.as_ref(),
        ]);
        // Digest is the hash of the message
        keccak::hashv(&[message_hash.as_ref()])
            .as_ref()
            .try_into()
            .unwrap()
    }

    pub fn get_slow_order_response<'a>(&'a self) -> Result<SlowOrderResponse<'a>> {
        let liquidity_layer_message: LiquidityLayerDepositMessage<'a> =
            LiquidityLayerDepositMessage::parse(&self.deposit_payload)
                .map_err(|_| MatchingEngineError::InvalidDepositPayloadId)?;
        let slow_order_response: SlowOrderResponse<'a> =
            liquidity_layer_message.to_slow_order_response_unchecked();
        Ok(slow_order_response)
    }
}

impl PrepareOrderResponseCctpShimData {
    pub fn new(
        encoded_cctp_message: Vec<u8>,
        cctp_attestation: Vec<u8>,
        finalized_vaa_message: FinalizedVaaMessage,
    ) -> Self {
        Self {
            encoded_cctp_message,
            cctp_attestation,
            finalized_vaa_message,
        }
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
        ReceiveMessageArgs {
            encoded_message,
            attestation: cctp_attestation,
        }
    }
}

pub struct PrepareOrderResponseCctpShimAccounts<'ix> {
    pub signer: &'ix Pubkey,                                      // 0
    pub custodian: &'ix Pubkey,                                   // 1
    pub fast_market_order: &'ix Pubkey,                           // 2
    pub from_endpoint: &'ix Pubkey,                               // 3
    pub to_endpoint: &'ix Pubkey,                                 // 4
    pub prepared_order_response: &'ix Pubkey,                     // 5
    pub prepared_custody_token: &'ix Pubkey,                      // 6
    pub base_fee_token: &'ix Pubkey,                              // 7
    pub usdc: &'ix Pubkey,                                        // 8
    pub cctp_mint_recipient: &'ix Pubkey,                         // 9
    pub cctp_message_transmitter_authority: &'ix Pubkey,          // 10
    pub cctp_message_transmitter_config: &'ix Pubkey,             // 11
    pub cctp_used_nonces: &'ix Pubkey,                            // 12
    pub cctp_message_transmitter_event_authority: &'ix Pubkey,    // 13
    pub cctp_token_messenger: &'ix Pubkey,                        // 14
    pub cctp_remote_token_messenger: &'ix Pubkey,                 // 15
    pub cctp_token_minter: &'ix Pubkey,                           // 16
    pub cctp_local_token: &'ix Pubkey,                            // 17
    pub cctp_token_pair: &'ix Pubkey,                             // 18
    pub cctp_token_messenger_minter_custody_token: &'ix Pubkey,   // 19
    pub cctp_token_messenger_minter_event_authority: &'ix Pubkey, // 20
    pub cctp_token_messenger_minter_program: &'ix Pubkey,         // 21
    pub cctp_message_transmitter_program: &'ix Pubkey,            // 22
    pub guardian_set: &'ix Pubkey,                                // 23
    pub guardian_set_signatures: &'ix Pubkey,                     // 24
    pub verify_shim_program: &'ix Pubkey,                         // 25
    pub token_program: &'ix Pubkey,                               // 26
    pub system_program: &'ix Pubkey,                              // 27
}

impl<'ix> PrepareOrderResponseCctpShimAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.signer, true),
            AccountMeta::new_readonly(*self.custodian, false),
            AccountMeta::new_readonly(*self.fast_market_order, false),
            AccountMeta::new_readonly(*self.from_endpoint, false),
            AccountMeta::new_readonly(*self.to_endpoint, false),
            AccountMeta::new(*self.prepared_order_response, false),
            AccountMeta::new(*self.prepared_custody_token, false),
            AccountMeta::new_readonly(*self.base_fee_token, false),
            AccountMeta::new_readonly(*self.usdc, false),
            AccountMeta::new(*self.cctp_mint_recipient, false),
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

// TODO: Also close the fast market order account since it is no longer needed
pub struct PrepareOrderResponseCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: PrepareOrderResponseCctpShimAccounts<'ix>,
    pub data: PrepareOrderResponseCctpShimData,
}

impl<'ix> PrepareOrderResponseCctpShim<'ix> {
    pub fn instruction(self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: FallbackMatchingEngineInstruction::PrepareOrderResponseCctpShim(self.data)
                .to_vec(),
        }
    }
}

pub fn prepare_order_response_cctp_shim(
    accounts: &[AccountInfo],
    data: PrepareOrderResponseCctpShimData,
) -> Result<()> {
    let program_id = &crate::ID;
    check_account_length(accounts, 27)?;

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

    let deposit_option = LiquidityLayerMessage::parse(&finalized_vaa_message.vaa_payload)
        .map_err(|_| MatchingEngineError::InvalidDeposit)?;
    let deposit = deposit_option
        .deposit()
        .ok_or_else(|| MatchingEngineError::InvalidDepositPayloadId)?;
    let cctp_message = CctpMessage::parse(&receive_message_args.encoded_message)
        .map_err(|_| MatchingEngineError::InvalidCctpMessage)?;
    require_eq!(
        cctp_message.source_domain(),
        deposit.source_cctp_domain(),
        MatchingEngineError::InvalidCctpMessage
    );
    require_eq!(
        cctp_message.destination_domain(),
        deposit.destination_cctp_domain(),
        MatchingEngineError::InvalidCctpMessage
    );
    require_eq!(
        cctp_message.nonce(),
        deposit.cctp_nonce(),
        MatchingEngineError::InvalidCctpMessage
    );
    // Load accounts
    let fast_market_order_account_data = fast_market_order.data.borrow();
    let fast_market_order_zero_copy =
        FastMarketOrderState::try_read(&fast_market_order_account_data[..])?;
    // Create pdas for addresses that need to be created
    // Check the prepared order response account is valid
    // TODO: Pass the digest so it isn't recomputed
    let fast_market_order_digest = fast_market_order_zero_copy.digest();
    // Construct the finalised vaa message digest data
    let finalized_vaa_message_digest = {
        let finalised_vaa_timestamp = fast_market_order_zero_copy.vaa_timestamp;
        let finalised_vaa_sequence = fast_market_order_zero_copy.vaa_sequence.saturating_sub(1);
        let finalised_vaa_emitter_chain = fast_market_order_zero_copy.vaa_emitter_chain;
        let finalised_vaa_emitter_address = fast_market_order_zero_copy.vaa_emitter_address;
        let finalised_vaa_nonce = fast_market_order_zero_copy.vaa_nonce;
        let finalised_vaa_consistency_level = fast_market_order_zero_copy.vaa_consistency_level;
        finalized_vaa_message.digest(
            finalised_vaa_sequence,
            finalised_vaa_timestamp,
            finalised_vaa_emitter_chain,
            finalised_vaa_emitter_address,
            finalised_vaa_nonce,
            finalised_vaa_consistency_level,
        )
    };

    // Check that fast market order is owned by the program
    require!(
        fast_market_order.owner == program_id,
        ErrorCode::ConstraintOwner
    );

    let checked_custodian =
        Custodian::try_deserialize(&mut &custodian.data.borrow()[..]).map(Box::new)?;
    // Deserialise the to_endpoint account

    // TODO:  Scope this to do checks and deallocate stack
    let to_endpoint_account =
        RouterEndpoint::try_deserialize(&mut &to_endpoint.data.borrow()[..]).map(Box::new)?;
    // Deserialise the from_endpoint account
    let from_endpoint_account =
        RouterEndpoint::try_deserialize(&mut &from_endpoint.data.borrow()[..]).map(Box::new)?;

    let guardian_set_bump = finalized_vaa_message.guardian_set_bump;

    // Check loaded vaa is deposit message
    // TODO: Fix errors
    let liquidity_layer_message =
        LiquidityLayerDepositMessage::parse(&finalized_vaa_message.deposit_payload)
            .map_err(|_| MatchingEngineError::InvalidDepositPayloadId)?;
    let slow_order_response = liquidity_layer_message
        .slow_order_response()
        .ok_or_else(|| MatchingEngineError::InvalidDepositPayloadId)?;
    let prepared_order_response_seeds = [
        PreparedOrderResponse::SEED_PREFIX,
        &fast_market_order_digest,
    ];

    let (prepared_order_response_pda, prepared_order_response_bump) =
        Pubkey::find_program_address(&prepared_order_response_seeds, program_id);

    let prepared_custody_token_seeds = [
        crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
        prepared_order_response_pda.as_ref(),
    ];

    let (prepared_custody_token_pda, prepared_custody_token_bump) =
        Pubkey::find_program_address(&prepared_custody_token_seeds, program_id);

    // Check custodian account
    require_eq!(custodian.owner, program_id, ErrorCode::ConstraintOwner);

    require!(!checked_custodian.paused, MatchingEngineError::Paused);

    // Check usdc mint
    require_eq!(
        usdc.key(),
        common::USDC_MINT,
        MatchingEngineError::InvalidMint
    );

    // Check from_endpoint owner
    require_eq!(from_endpoint.owner, program_id, ErrorCode::ConstraintOwner);

    // Check to_endpoint owner
    require_eq!(to_endpoint.owner, program_id, ErrorCode::ConstraintOwner);

    // Check that the from and to endpoints are different
    require_neq!(
        from_endpoint_account.chain,
        to_endpoint_account.chain,
        MatchingEngineError::SameEndpoint
    );

    // Check that the to endpoint protocol is cctp or local
    require!(
        matches!(
            to_endpoint_account.protocol,
            MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. }
        ),
        MatchingEngineError::InvalidEndpoint
    );

    // Check that the from endpoint protocol is cctp or local
    require!(
        matches!(
            from_endpoint_account.protocol,
            MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. }
        ),
        MatchingEngineError::InvalidEndpoint
    );

    // Check that to endpoint chain is equal to the fast_market_order target_chain
    require_eq!(
        to_endpoint_account.chain,
        fast_market_order_zero_copy.target_chain,
        MatchingEngineError::InvalidTargetRouter
    );

    require_eq!(
        prepared_order_response_pda,
        prepared_order_response.key(),
        MatchingEngineError::InvalidPda
    );

    require_eq!(
        prepared_custody_token_pda,
        prepared_custody_token.key(),
        MatchingEngineError::InvalidPda
    );

    // Check the base token fee key is not equal to the prepared custody token key
    // TODO: Check that base fee token is actually a token account
    require_neq!(
        base_fee_token.key(),
        prepared_custody_token.key(),
        MatchingEngineError::InvalidBaseFeeToken
    );

    require_eq!(
        token_program.key(),
        spl_token::ID,
        MatchingEngineError::InvalidProgram
    );

    require_eq!(
        _verify_shim_program.key(),
        wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
        MatchingEngineError::InvalidProgram
    );

    require_eq!(
        system_program.key(),
        solana_program::system_program::ID,
        MatchingEngineError::InvalidProgram
    );

    // Verify deposit message shim using verify shim program

    // Start verify deposit message vaa shim
    // ------------------------------------------------------------------------------------------------
    let verify_hash_data = {
        let mut data = vec![];
        data.extend_from_slice(
            &wormhole_svm_shim::verify_vaa::VerifyVaaShimInstruction::<false>::VERIFY_HASH_SELECTOR,
        );
        data.push(guardian_set_bump);
        data.extend_from_slice(&finalized_vaa_message_digest);
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
    invoke_signed_unchecked(&verify_shim_ix, accounts, &[])?;
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
        &fast_market_order_digest,
        &[prepared_order_response_bump],
    ];
    let prepared_order_response_signer_seeds = &[&create_prepared_order_respone_seeds[..]];
    let prepared_order_response_account_space = PreparedOrderResponse::compute_size(
        fast_market_order_zero_copy.redeemer_message_length.into(),
    );
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
            fast_vaa_hash: fast_market_order_digest,
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
        redeemer_message: fast_market_order_zero_copy.redeemer_message
            [..usize::from(fast_market_order_zero_copy.redeemer_message_length)]
            .to_vec(),
    };
    // Use cursor in order to write the prepared order response account data
    let prepared_order_response_data: &mut [u8] = &mut prepared_order_response
        .try_borrow_mut_data()
        .map_err(|_| MatchingEngineError::AccountNotWritable)?;
    let mut cursor = Cursor::new(prepared_order_response_data);
    prepared_order_response_account_to_write
        .try_serialize(&mut cursor)
        .map_err(|_| MatchingEngineError::BorshDeserializationError)?;
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
        &spl_token::ID,
        prepared_custody_token_signer_seeds,
    )?;
    let init_token_account_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        &prepared_custody_token_pda,
        &usdc.key(),
        &prepared_order_response_pda,
    )?;
    solana_program::program::invoke_signed_unchecked(&init_token_account_ix, accounts, &[])?;
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
                token_messenger_minter_program: cctp_token_messenger_minter_program
                    .to_account_info(),
                system_program: system_program.to_account_info(),
                message_transmitter_event_authority: cctp_message_transmitter_event_authority
                    .to_account_info(),
                message_transmitter_program: cctp_message_transmitter_program.to_account_info(),
                token_messenger: cctp_token_messenger.to_account_info(),
                remote_token_messenger: cctp_remote_token_messenger.to_account_info(),
                token_minter: cctp_token_minter.to_account_info(),
                local_token: cctp_local_token.to_account_info(),
                token_pair: cctp_token_pair.to_account_info(),
                mint_recipient: cctp_mint_recipient.to_account_info(),
                custody_token: cctp_token_messenger_minter_custody_token.to_account_info(),
                token_program: token_program.to_account_info(),
                token_messenger_minter_event_authority: cctp_token_messenger_minter_event_authority
                    .to_account_info(),
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
        &custodian.key(),
        &[], // Apparently this is only for multi-sig accounts
        fast_market_order_zero_copy.amount_in,
    )
    .unwrap();

    invoke_signed_unchecked(&transfer_ix, accounts, &[Custodian::SIGNER_SEEDS])
        .map_err(|_| MatchingEngineError::TokenTransferFailed)?;

    Ok(())
}
