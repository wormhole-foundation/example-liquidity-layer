use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use borsh::{BorshDeserialize, BorshSerialize};
use common::{
    messages::SlowOrderResponse,
    wormhole_cctp_solana::{
        cctp::message_transmitter_program::{self, ID as CCTP_MESSAGE_TRANSMITTER_PROGRAM_ID},
        cpi::ReceiveMessageArgs,
        messages::Deposit,
        utils::CctpMessage,
    },
    wormhole_io::TypePrefixedPayload,
    USDC_MINT,
};
use ruint::aliases::U256;
use solana_program::{instruction::Instruction, keccak, program::invoke_signed_unchecked};

use crate::{
    error::MatchingEngineError,
    fallback::helpers::{create_usdc_token_account_reliably, require_min_account_infos_len},
    state::{
        Custodian, MessageProtocol, PreparedOrderResponse, PreparedOrderResponseInfo,
        PreparedOrderResponseSeeds,
    },
    CCTP_MINT_RECIPIENT, ID,
};

const NUM_ACCOUNTS: usize = 28;

#[derive(BorshDeserialize, BorshSerialize)]
pub struct PrepareOrderResponseCctpShimData {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message_args: FinalizedVaaMessageArgs,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct FinalizedVaaMessageArgs {
    pub base_fee: u64,
    pub consistency_level: u8,
    pub guardian_set_bump: u8,
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
    pub verify_shim_program: &'ix Pubkey,                         // 9
    pub guardian_set: &'ix Pubkey,                                // 10
    pub guardian_set_signatures: &'ix Pubkey,                     // 11
    pub cctp_message_transmitter_program: &'ix Pubkey,            // 12
    pub cctp_message_transmitter_authority: &'ix Pubkey,          // 13
    pub cctp_message_transmitter_config: &'ix Pubkey,             // 14
    pub cctp_used_nonces: &'ix Pubkey,                            // 15
    pub cctp_message_transmitter_event_authority: &'ix Pubkey,    // 16
    pub cctp_token_messenger: &'ix Pubkey,                        // 17
    pub cctp_remote_token_messenger: &'ix Pubkey,                 // 18
    pub cctp_token_minter: &'ix Pubkey,                           // 19
    pub cctp_local_token: &'ix Pubkey,                            // 20
    pub cctp_token_pair: &'ix Pubkey,                             // 21
    pub cctp_token_messenger_minter_custody_token: &'ix Pubkey,   // 22
    pub cctp_token_messenger_minter_event_authority: &'ix Pubkey, // 23
    pub cctp_token_messenger_minter_program: &'ix Pubkey,         // 24
    pub cctp_mint_recipient: &'ix Pubkey,                         // 25
    // TODO: Remove
    pub token_program: &'ix Pubkey, // 26
    // TODO: Remove
    pub system_program: &'ix Pubkey, // 27
}

pub struct PrepareOrderResponseCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: PrepareOrderResponseCctpShimAccounts<'ix>,
    pub data: PrepareOrderResponseCctpShimData,
}

impl<'ix> PrepareOrderResponseCctpShim<'ix> {
    pub fn instruction(self) -> Instruction {
        let PrepareOrderResponseCctpShimAccounts {
            signer,
            custodian,
            fast_market_order,
            from_endpoint,
            to_endpoint,
            prepared_order_response,
            prepared_custody_token,
            base_fee_token,
            usdc,
            verify_shim_program,
            guardian_set,
            guardian_set_signatures,
            cctp_message_transmitter_program,
            cctp_mint_recipient,
            cctp_message_transmitter_authority,
            cctp_message_transmitter_config,
            cctp_used_nonces,
            cctp_message_transmitter_event_authority,
            cctp_token_messenger,
            cctp_remote_token_messenger,
            cctp_token_minter,
            cctp_local_token,
            cctp_token_pair,
            cctp_token_messenger_minter_custody_token,
            cctp_token_messenger_minter_event_authority,
            cctp_token_messenger_minter_program,
            token_program: _,
            system_program: _,
        } = self.accounts;

        let accounts = vec![
            AccountMeta::new(*signer, true),
            AccountMeta::new_readonly(*custodian, false),
            AccountMeta::new_readonly(*fast_market_order, false),
            AccountMeta::new_readonly(*from_endpoint, false),
            AccountMeta::new_readonly(*to_endpoint, false),
            AccountMeta::new(*prepared_order_response, false),
            AccountMeta::new(*prepared_custody_token, false),
            AccountMeta::new_readonly(*base_fee_token, false),
            AccountMeta::new_readonly(*usdc, false),
            AccountMeta::new_readonly(*verify_shim_program, false),
            AccountMeta::new_readonly(*guardian_set, false),
            AccountMeta::new_readonly(*guardian_set_signatures, false),
            AccountMeta::new_readonly(*cctp_message_transmitter_program, false),
            AccountMeta::new_readonly(*cctp_message_transmitter_authority, false),
            AccountMeta::new_readonly(*cctp_message_transmitter_config, false),
            AccountMeta::new(*cctp_used_nonces, false),
            AccountMeta::new_readonly(*cctp_message_transmitter_event_authority, false),
            AccountMeta::new_readonly(*cctp_token_messenger, false),
            AccountMeta::new_readonly(*cctp_remote_token_messenger, false),
            AccountMeta::new_readonly(*cctp_token_minter, false),
            AccountMeta::new(*cctp_local_token, false),
            AccountMeta::new_readonly(*cctp_token_pair, false),
            AccountMeta::new(*cctp_token_messenger_minter_custody_token, false),
            AccountMeta::new_readonly(*cctp_token_messenger_minter_event_authority, false),
            AccountMeta::new_readonly(*cctp_token_messenger_minter_program, false),
            AccountMeta::new(*cctp_mint_recipient, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(solana_program::system_program::ID, false),
        ];
        debug_assert_eq!(accounts.len(), NUM_ACCOUNTS);

        Instruction {
            program_id: *self.program_id,
            accounts,
            data: super::FallbackMatchingEngineInstruction::PrepareOrderResponseCctpShim(self.data)
                .to_vec(),
        }
    }
}

pub fn prepare_order_response_cctp_shim(
    accounts: &[AccountInfo],
    data: PrepareOrderResponseCctpShimData,
) -> Result<()> {
    require_min_account_infos_len(accounts, NUM_ACCOUNTS)?;

    let payer_info = &accounts[0];

    let custodian_info = &accounts[1];
    super::helpers::try_custodian_account(custodian_info, false)?;

    let fast_market_order = super::helpers::try_fast_market_order_account(&accounts[2])?;

    let (from_endpoint, to_endpoint) =
        super::helpers::try_live_endpoint_accounts_path(&accounts[3], &accounts[4])?;

    // Check that the to endpoint protocol is cctp or local
    require!(
        matches!(
            to_endpoint.protocol,
            MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. }
        ),
        MatchingEngineError::InvalidEndpoint
    );

    // The destination registered endpoint must match the fast market order's
    // target chain. We cache this endpoint's info in the new prepared order
    // response account.
    require_eq!(
        to_endpoint.chain,
        fast_market_order.target_chain,
        MatchingEngineError::InvalidTargetRouter
    );

    // These accounts will be created by the end of this instruction.
    let new_prepared_order_response_info = &accounts[5];
    let new_prepared_custody_info = &accounts[6];

    let base_fee_token_info = &accounts[7];

    // Unlikely to happen, but we disallow the base fee token account to be the
    // same as the new prepared custody token account.
    if base_fee_token_info.key == new_prepared_custody_info.key {
        return Err(MatchingEngineError::InvalidBaseFeeToken.into());
    }

    // This account must be the USDC mint. This instruction does not refer to
    // this account explicitly. It just needs to exist so that we can create the
    // prepared order response's custody token account.
    super::helpers::try_usdc_account(&accounts[8])?;

    let PrepareOrderResponseCctpShimData {
        encoded_cctp_message,
        cctp_attestation,
        finalized_vaa_message_args:
            FinalizedVaaMessageArgs {
                base_fee,
                consistency_level: finalized_consistency_level,
                guardian_set_bump,
            },
    } = data;

    // We can generate the finalized VAA message hash using instruction data,
    // the fast market order account and the CCTP message contents. The fast
    // message is emitted after the finalized message atomically via the Token
    // Router.

    let cctp_message = CctpMessage::parse(&encoded_cctp_message)
        .map_err(|_| MatchingEngineError::InvalidCctpMessage)?;

    let fast_vaa_timestamp = fast_market_order.vaa_timestamp;
    let source_chain = fast_market_order.vaa_emitter_chain;
    let amount_in = fast_market_order.amount_in;

    let finalized_message_digest = wormhole_svm_definitions::compute_keccak_digest(
        keccak::hashv(&[
            &fast_vaa_timestamp.to_be_bytes(),
            &[0, 0, 0, 0], // 0 nonce
            &source_chain.to_be_bytes(),
            &fast_market_order.vaa_emitter_address,
            &fast_market_order
                .vaa_sequence
                .saturating_sub(1)
                .to_be_bytes(),
            &[finalized_consistency_level],
            &Deposit {
                // TODO: I don't believe this is right. This needs to be the
                // source token address, which can be found in the CCTP
                // token pair account.
                token_address: USDC_MINT.to_bytes(),
                amount: U256::from(amount_in),
                source_cctp_domain: cctp_message.source_domain(),
                destination_cctp_domain: cctp_message.destination_domain(),
                cctp_nonce: cctp_message.nonce(),
                burn_source: from_endpoint.mint_recipient,
                mint_recipient: CCTP_MINT_RECIPIENT.to_bytes(),
                payload: SlowOrderResponse { base_fee }.to_vec().try_into()?,
            }
            .to_vec(),
        ]),
        None,
    );

    // Verify the VAA digest with the Verify VAA shim program.
    super::helpers::invoke_verify_hash(
        9,  // verify_vaa_shim_program_index
        10, // wormhole_guardian_set_index
        11, // shim_guardian_signatures_index
        guardian_set_bump,
        finalized_message_digest,
        accounts,
    )?;

    // Write to the prepared slow order account, which will be closed by one of
    // the following instructions:
    // * settle_auction_active_cctp
    // * settle_auction_complete
    // * settle_auction_none

    let fast_market_order_digest = fast_market_order.digest();

    let (expected_prepared_order_response_key, prepared_order_response_bump) =
        Pubkey::find_program_address(
            &[
                PreparedOrderResponse::SEED_PREFIX,
                &fast_market_order_digest,
            ],
            &ID,
        );

    super::helpers::create_account_reliably(
        payer_info.key,
        &expected_prepared_order_response_key,
        new_prepared_order_response_info.lamports(),
        PreparedOrderResponse::compute_size(fast_market_order.redeemer_message_length.into()),
        accounts,
        &ID,
        &[&[
            PreparedOrderResponse::SEED_PREFIX,
            &fast_market_order_digest,
            &[prepared_order_response_bump],
        ]],
    )?;

    let (expected_prepared_custody_key, prepared_custody_token_bump) = Pubkey::find_program_address(
        &[
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            expected_prepared_order_response_key.as_ref(),
        ],
        &ID,
    );

    create_usdc_token_account_reliably(
        payer_info.key,
        &expected_prepared_custody_key,
        &expected_prepared_order_response_key,
        new_prepared_custody_info.lamports(),
        accounts,
        &[&[
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            expected_prepared_order_response_key.as_ref(),
            &[prepared_custody_token_bump],
        ]],
    )?;

    // Mint the USDC to the matching engine's mint recipient, which will be
    // transferred to the newly created custody token account immediately after.

    let cctp_message_transmitter_program = &accounts[12];

    if cctp_message_transmitter_program.key != &CCTP_MESSAGE_TRANSMITTER_PROGRAM_ID {
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_account_name("token_messenger_minter_program")
                .with_pubkeys((
                    *cctp_message_transmitter_program.key,
                    CCTP_MESSAGE_TRANSMITTER_PROGRAM_ID,
                ))
        });
    };

    // These accounts will be used later when we invoke the CCTP Message
    // Transmitter to mint USDC via the CCTP Token Messenger Minter program.

    let cctp_message_transmitter_authority_info = &accounts[13];
    let cctp_message_transmitter_config_info = &accounts[14];
    let cctp_used_nonces_info = &accounts[15];
    let cctp_message_transmitter_event_authority_info = &accounts[16];
    let cctp_token_messenger_info = &accounts[17];
    let cctp_remote_token_messenger_info = &accounts[18];
    let cctp_token_minter_info = &accounts[19];
    let cctp_local_token_info = &accounts[20];
    let cctp_token_pair_info = &accounts[21];
    let cctp_token_messenger_minter_custody_token_info = &accounts[22];
    let cctp_token_messenger_minter_event_authority_info = &accounts[23];
    let cctp_token_messenger_minter_program_info = &accounts[24];
    let cctp_mint_recipient_info = &accounts[25];
    let token_program_info = &accounts[26];
    let system_program_info = &accounts[27];

    message_transmitter_program::cpi::receive_token_messenger_minter_message(
        CpiContext::new_with_signer(
            cctp_message_transmitter_program.to_account_info(),
            message_transmitter_program::cpi::ReceiveTokenMessengerMinterMessage {
                payer: payer_info.to_account_info(),
                caller: custodian_info.to_account_info(),
                message_transmitter_authority: cctp_message_transmitter_authority_info
                    .to_account_info(),
                message_transmitter_config: cctp_message_transmitter_config_info.to_account_info(),
                used_nonces: cctp_used_nonces_info.to_account_info(),
                token_messenger_minter_program: cctp_token_messenger_minter_program_info
                    .to_account_info(),
                system_program: system_program_info.to_account_info(),
                message_transmitter_event_authority: cctp_message_transmitter_event_authority_info
                    .to_account_info(),
                message_transmitter_program: cctp_message_transmitter_program.to_account_info(),
                token_messenger: cctp_token_messenger_info.to_account_info(),
                remote_token_messenger: cctp_remote_token_messenger_info.to_account_info(),
                token_minter: cctp_token_minter_info.to_account_info(),
                local_token: cctp_local_token_info.to_account_info(),
                token_pair: cctp_token_pair_info.to_account_info(),
                mint_recipient: cctp_mint_recipient_info.to_account_info(),
                custody_token: cctp_token_messenger_minter_custody_token_info.to_account_info(),
                token_program: token_program_info.to_account_info(),
                token_messenger_minter_event_authority:
                    cctp_token_messenger_minter_event_authority_info.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        ReceiveMessageArgs {
            encoded_message: encoded_cctp_message,
            attestation: cctp_attestation,
        },
    )?;

    // Finally transfer minted via CCTP to prepared custody token.
    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        &CCTP_MINT_RECIPIENT,
        &expected_prepared_custody_key,
        custodian_info.key,
        &[], // Apparently this is only for multi-sig accounts
        amount_in,
    )
    .unwrap();

    invoke_signed_unchecked(&transfer_ix, accounts, &[Custodian::SIGNER_SEEDS])?;

    // Finally serialize the prepared order response data into the newly created
    // account.
    let new_prepared_order_response_info_data: &mut [u8] =
        &mut new_prepared_order_response_info.try_borrow_mut_data()?;
    let mut new_prepared_order_response_cursor =
        std::io::Cursor::new(new_prepared_order_response_info_data);

    PreparedOrderResponse {
        seeds: PreparedOrderResponseSeeds {
            fast_vaa_hash: fast_market_order_digest,
            bump: prepared_order_response_bump,
        },
        info: PreparedOrderResponseInfo {
            prepared_by: *payer_info.key,
            base_fee_token: *base_fee_token_info.key,
            source_chain,
            base_fee,
            fast_vaa_timestamp,
            amount_in,
            sender: fast_market_order.sender,
            redeemer: fast_market_order.redeemer,
            init_auction_fee: fast_market_order.init_auction_fee,
        },
        to_endpoint: to_endpoint.info,
        redeemer_message: fast_market_order.redeemer_message
            [..fast_market_order.redeemer_message_length.into()]
            .to_vec(),
    }
    .try_serialize(&mut new_prepared_order_response_cursor)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_instruction() {
        PrepareOrderResponseCctpShim {
            program_id: &Default::default(),
            accounts: PrepareOrderResponseCctpShimAccounts {
                signer: &Default::default(),
                custodian: &Default::default(),
                fast_market_order: &Default::default(),
                from_endpoint: &Default::default(),
                to_endpoint: &Default::default(),
                prepared_order_response: &Default::default(),
                prepared_custody_token: &Default::default(),
                base_fee_token: &Default::default(),
                usdc: &Default::default(),
                verify_shim_program: &Default::default(),
                guardian_set: &Default::default(),
                guardian_set_signatures: &Default::default(),
                cctp_message_transmitter_program: &Default::default(),
                cctp_mint_recipient: &Default::default(),
                cctp_message_transmitter_authority: &Default::default(),
                cctp_message_transmitter_config: &Default::default(),
                cctp_used_nonces: &Default::default(),
                cctp_message_transmitter_event_authority: &Default::default(),
                cctp_token_messenger: &Default::default(),
                cctp_remote_token_messenger: &Default::default(),
                cctp_token_minter: &Default::default(),
                cctp_local_token: &Default::default(),
                cctp_token_pair: &Default::default(),
                cctp_token_messenger_minter_custody_token: &Default::default(),
                cctp_token_messenger_minter_event_authority: &Default::default(),
                cctp_token_messenger_minter_program: &Default::default(),
                token_program: &Default::default(),
                system_program: &Default::default(),
            },
            data: PrepareOrderResponseCctpShimData {
                encoded_cctp_message: Default::default(),
                cctp_attestation: Default::default(),
                finalized_vaa_message_args: FinalizedVaaMessageArgs {
                    base_fee: Default::default(),
                    consistency_level: Default::default(),
                    guardian_set_bump: Default::default(),
                },
            },
        }
        .instruction();
    }
}
