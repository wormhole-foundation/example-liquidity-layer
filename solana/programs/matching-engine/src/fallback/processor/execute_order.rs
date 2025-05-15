use anchor_lang::prelude::*;
use anchor_spl::token::{spl_token, TokenAccount};
use common::{
    messages::Fill,
    wormhole_cctp_solana::cctp::token_messenger_minter_program::ID as CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    wormhole_io::TypePrefixedPayload,
};
use solana_program::{instruction::Instruction, program::invoke_signed_unchecked};

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, Custodian, MessageProtocol},
    utils::{self, auction::DepositPenalty},
    ID,
};

use super::burn_and_post::{burn_and_post, PostMessageAccounts};

const NUM_ACCOUNTS: usize = 32;

// TODO: Rename to "ExecuteOrderCctpV2Accounts".
#[derive(Debug, Clone, PartialEq, Eq, Copy)]
pub struct ExecuteOrderShimAccounts<'ix> {
    /// The signer account.
    // TODO: Rename to "payer".
    pub signer: &'ix Pubkey, // 0
    /// The cctp message account. Seeds must be \["cctp-msg", auction_address.as_ref()\].
    // TODO: Rename to "new_cctp_message".
    pub cctp_message: &'ix Pubkey, // 1
    pub custodian: &'ix Pubkey, // 2
    /// Seeds must be \["fast_market_order", auction_address.as_ref()\].
    pub fast_market_order: &'ix Pubkey, // 3
    /// The auction account created from the place initial offer instruction.
    pub active_auction: &'ix Pubkey, // 4
    /// The associated token address of the auction's custody token.
    // TODO: Rename to "auction_custody".
    pub active_auction_custody_token: &'ix Pubkey, // 5
    /// The auction config account created from the place initial offer instruction.
    // TODO: Rename to "auction_config".
    pub active_auction_config: &'ix Pubkey, // 6
    /// The token account of the auction's best offer
    // TODO: Rename to "auction_best_offer_token".
    pub active_auction_best_offer_token: &'ix Pubkey, // 7
    /// The token account of the executor
    pub executor_token: &'ix Pubkey, // 8
    /// The token account of the auction's initial offer
    // TODO: Rename to "auction_initial_offer_token".
    pub initial_offer_token: &'ix Pubkey, // 9
    /// The account that signed the creation of the auction when placing the initial offer.
    // TODO: Rename to "auction_initial_participant".
    pub initial_participant: &'ix Pubkey, // 10
    /// The router endpoint account of the auction's target chain
    // TODO: Rename to "to_endpoint".
    pub to_router_endpoint: &'ix Pubkey, // 11
    /// The program id of the post message shim program
    pub post_message_shim_program: &'ix Pubkey, // 12
    /// The emitter sequence of the core bridge program (can be derived)
    pub core_bridge_emitter_sequence: &'ix Pubkey, // 13
    /// The message account of the post message shim program (can be derived)
    // TODO: Rename to "shim_message".
    pub post_shim_message: &'ix Pubkey, // 14
    pub cctp_deposit_for_burn_token_messenger_minter_program: &'ix Pubkey, // 15
    /// The mint account of the CCTP token to be burned
    pub cctp_deposit_for_burn_mint: &'ix Pubkey, // 16
    /// The token messenger minter sender authority account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger_minter_sender_authority: &'ix Pubkey, // 17
    /// The message transmitter config account of the CCTP token to be burned
    pub cctp_deposit_for_burn_message_transmitter_config: &'ix Pubkey, // 18
    /// The token messenger account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger: &'ix Pubkey, // 19
    /// The remote token messenger account of the CCTP token to be burned
    pub cctp_deposit_for_burn_remote_token_messenger: &'ix Pubkey, // 20
    /// The token minter account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_minter: &'ix Pubkey, // 21
    /// The local token account of the CCTP token to be burned
    pub cctp_deposit_for_burn_local_token: &'ix Pubkey, // 22
    /// The token messenger minter event authority account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger_minter_event_authority: &'ix Pubkey, // 23
    /// The token messenger minter program account of the CCTP token to be burned
    /// The message transmitter program account of the CCTP token to be burned
    pub cctp_deposit_for_burn_message_transmitter_program: &'ix Pubkey, // 24
    /// The program id of the core bridge program
    pub core_bridge_program: &'ix Pubkey, // 25
    /// The config account of the core bridge program
    pub core_bridge_config: &'ix Pubkey, // 26
    /// The fee collector account of the core bridge program
    pub core_bridge_fee_collector: &'ix Pubkey, // 27
    /// The event authority account of the post message shim program
    pub post_message_shim_event_authority: &'ix Pubkey, // 28
    /// The program id of the system program
    // TODO: Remove.
    pub system_program: &'ix Pubkey, // 29
    /// The program id of the token program
    // TODO: Remove.
    pub token_program: &'ix Pubkey, // 30
    /// The clock account
    // TODO: Remove.
    pub clock: &'ix Pubkey, // 31
}

// TODO: Rename to "ExecuteOrderCctpV2".
pub struct ExecuteOrderCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: ExecuteOrderShimAccounts<'ix>,
}

impl ExecuteOrderCctpShim<'_> {
    pub fn instruction(&self) -> Instruction {
        let ExecuteOrderShimAccounts {
            signer: payer,
            cctp_message: new_cctp_message,
            custodian,
            fast_market_order,
            active_auction,
            active_auction_custody_token: auction_custody,
            active_auction_config: auction_config,
            active_auction_best_offer_token: auction_best_offer_token,
            executor_token,
            initial_offer_token: auction_initial_offer_token,
            initial_participant: auction_initial_participant,
            to_router_endpoint: to_endpoint,
            post_message_shim_program,
            core_bridge_emitter_sequence,
            post_shim_message: shim_message,
            cctp_deposit_for_burn_mint: cctp_mint,
            cctp_deposit_for_burn_token_messenger_minter_sender_authority:
                cctp_token_messenger_minter_sender_authority,
            cctp_deposit_for_burn_message_transmitter_config: cctp_message_transmitter_config,
            cctp_deposit_for_burn_token_messenger: cctp_token_messenger,
            cctp_deposit_for_burn_remote_token_messenger: cctp_remote_token_messenger,
            cctp_deposit_for_burn_token_minter: cctp_token_minter,
            cctp_deposit_for_burn_local_token: cctp_local_token,
            cctp_deposit_for_burn_token_messenger_minter_event_authority:
                cctp_token_messenger_minter_event_authority,
            cctp_deposit_for_burn_token_messenger_minter_program:
                cctp_token_messenger_minter_program,
            cctp_deposit_for_burn_message_transmitter_program: cctp_message_transmitter_program,
            core_bridge_program,
            core_bridge_config,
            core_bridge_fee_collector,
            post_message_shim_event_authority,
            system_program: _,
            token_program: _,
            clock: _,
        } = self.accounts;

        let accounts = vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*new_cctp_message, false),
            AccountMeta::new(*custodian, false),
            AccountMeta::new_readonly(*fast_market_order, false),
            AccountMeta::new(*active_auction, false),
            AccountMeta::new(*auction_custody, false),
            AccountMeta::new_readonly(*auction_config, false),
            AccountMeta::new(*auction_best_offer_token, false),
            AccountMeta::new(*executor_token, false),
            AccountMeta::new(*auction_initial_offer_token, false),
            AccountMeta::new(*auction_initial_participant, false),
            AccountMeta::new_readonly(*to_endpoint, false),
            AccountMeta::new_readonly(*post_message_shim_program, false),
            AccountMeta::new(*core_bridge_emitter_sequence, false),
            AccountMeta::new(*shim_message, false),
            AccountMeta::new_readonly(*cctp_token_messenger_minter_program, false),
            AccountMeta::new(*cctp_mint, false),
            AccountMeta::new_readonly(*cctp_token_messenger_minter_sender_authority, false),
            AccountMeta::new(*cctp_message_transmitter_config, false),
            AccountMeta::new_readonly(*cctp_token_messenger, false),
            AccountMeta::new_readonly(*cctp_remote_token_messenger, false),
            AccountMeta::new_readonly(*cctp_token_minter, false),
            AccountMeta::new(*cctp_local_token, false),
            AccountMeta::new_readonly(*cctp_token_messenger_minter_event_authority, false),
            AccountMeta::new_readonly(*cctp_message_transmitter_program, false),
            AccountMeta::new_readonly(*core_bridge_program, false),
            AccountMeta::new(*core_bridge_config, false),
            AccountMeta::new(*core_bridge_fee_collector, false),
            AccountMeta::new(*post_message_shim_event_authority, false),
            AccountMeta::new_readonly(solana_program::system_program::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(solana_program::sysvar::clock::ID, false),
        ];
        debug_assert_eq!(accounts.len(), NUM_ACCOUNTS);

        Instruction {
            program_id: *self.program_id,
            accounts,
            data: super::FallbackMatchingEngineInstruction::ExecuteOrderCctpShim.to_vec(),
        }
    }
}

#[inline(never)]
pub(super) fn process(accounts: &[AccountInfo]) -> Result<()> {
    // This saves stack space whereas having that in the body does not
    super::helpers::require_min_account_infos_len(accounts, NUM_ACCOUNTS)?;

    // Get the accounts
    let payer_info = &accounts[0];
    let new_cctp_message_info = &accounts[1];

    let custodian_info = &accounts[2];
    super::helpers::try_custodian_account(
        custodian_info,
        false, // check_if_paused
    )?;

    let fast_market_order = super::helpers::try_fast_market_order_account(&accounts[3])?;

    let active_auction_info = &accounts[4];
    super::helpers::require_owned_by_this_program(active_auction_info, "active_auction")?;

    let active_auction_key = active_auction_info.key();
    let mut active_auction = Auction::try_deserialize(&mut &active_auction_info.data.borrow()[..])?;
    let active_auction_inner_info = active_auction.info.as_ref().unwrap();

    require!(
        active_auction.vaa_hash == fast_market_order.digest(),
        MatchingEngineError::VaaMismatch
    );

    require!(
        active_auction.status == AuctionStatus::Active,
        MatchingEngineError::AuctionNotActive
    );

    let auction_custody_info = &accounts[5];

    // Check active auction custody token pda
    match Pubkey::create_program_address(
        &[
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            active_auction_key.as_ref(),
            &[active_auction_inner_info.custody_token_bump],
        ],
        &ID,
    ) {
        Err(_) => {
            return Err(MatchingEngineError::InvalidPda.into())
                .map_err(|e: Error| e.with_account_name("auction_custody"))
        }
        Ok(expected_key) if auction_custody_info.key != &expected_key => {
            return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
                e.with_account_name("auction_custody")
                    .with_pubkeys((*auction_custody_info.key, expected_key))
            })
        }
        _ => (),
    };

    // It is safe to unwrap here because we know the auction status is active,
    // which means its inner info is some `AuctionInfo`. This info specifies
    // which config ID was used.
    //
    // This inner info will also be used for token transfer accounting.
    let auction_config = super::helpers::try_auction_config_account(
        &accounts[6],
        Some(active_auction_inner_info.config_id),
    )?;

    // If solvers can still participate in the auction, we disallow executing
    // this auction's fast order.
    require!(
        !active_auction_inner_info.within_auction_duration(&auction_config),
        MatchingEngineError::AuctionPeriodNotExpired
    );

    let auction_best_offer_token_info = &accounts[7];

    require_keys_eq!(
        *auction_best_offer_token_info.key,
        active_auction_inner_info.best_offer_token,
        MatchingEngineError::BestOfferTokenMismatch
    );

    let executor_token_info = &accounts[8];
    let auction_initial_offer_token_info = &accounts[9];

    require_keys_eq!(
        *auction_initial_offer_token_info.key,
        active_auction_inner_info.initial_offer_token,
        MatchingEngineError::InitialOfferTokenMismatch
    );

    let auction_initial_participant_info = &accounts[10];

    if auction_initial_participant_info.key != &active_auction.prepared_by {
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_account_name("initial_participant").with_pubkeys((
                *auction_initial_participant_info.key,
                active_auction.prepared_by,
            ))
        });
    };

    let to_endpoint = super::helpers::try_live_endpoint_account(&accounts[11], "to_endpoint")?;

    // We ensure that the destination endpoint account is what we expect given
    // the target protocol found in the active auction account data.
    require_eq!(
        to_endpoint.protocol,
        active_auction.target_protocol,
        MatchingEngineError::InvalidTargetRouter
    );

    // This CCTP domain will be used later in the instruction to invoke CCTP
    // deposit for burn. But we assign this value here so we can revert early
    // based on which kind of message protocol the registered destination
    // endpoint is.
    let destination_cctp_domain = match to_endpoint.protocol {
        MessageProtocol::Cctp { domain } => domain,
        _ => {
            return Err(MatchingEngineError::InvalidCctpEndpoint.into())
                .map_err(|e: Error| e.with_account_name("to_endpoint"))
        }
    };

    // TODO: Consider grouping with the wormhole shim account infos?
    let _post_message_shim_program_info = &accounts[12];

    let core_bridge_emitter_sequence_info = &accounts[13];
    let shim_message_info = &accounts[14];

    // These accounts will be used to invoke the CCTP Token Messenger Minter
    // program to burn USDC (to be minted at the destination network).
    let cctp_account_infos = &accounts[16..25];

    // These accounts do not actually have to be in any particular order even if
    // an updated Anchor IDL specifies an order.
    let _wormhole_shim_account_infos = &accounts[25..28];

    // Do checks
    // ------------------------------------------------------------------------------------------------

    let cctp_token_messenger_minter_program_info = &accounts[15];

    // Check cctp deposit for burn token messenger minter program address
    if cctp_token_messenger_minter_program_info.key != &CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ID {
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_account_name("token_messenger_minter_program")
                .with_pubkeys((
                    *cctp_token_messenger_minter_program_info.key,
                    CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ID,
                ))
        });
    };

    // TODO: Do we have to verify the CCTP message transmitter program is passed
    // in?

    ////////////////////////////////////////////////////////////////////////////
    //
    // TODO: This execute order logic has been taken from the original execute
    // order instructions. We plan on using a helper method instead of copy-
    // pasting the same logic here.
    //
    ////////////////////////////////////////////////////////////////////////////

    // Prepare the execute order (get the user amount, fill, and order executed event)
    let current_slot = Clock::get().unwrap().slot;

    // We extend the grace period for locally executed orders. Reserving a sequence number for
    // the fast fill will most likely require an additional transaction, so this buffer allows
    // the best offer participant to perform his duty without the risk of getting slashed by
    // another executor.
    let additional_grace_period = match active_auction.target_protocol {
        MessageProtocol::Local { .. } => {
            crate::EXECUTE_FAST_ORDER_LOCAL_ADDITIONAL_GRACE_PERIOD.into()
        }
        _ => None,
    };

    let DepositPenalty {
        penalty,
        user_reward,
    } = utils::auction::compute_deposit_penalty(
        &auction_config,
        active_auction_inner_info,
        current_slot,
        additional_grace_period,
    );

    let init_auction_fee = fast_market_order.init_auction_fee;

    let user_amount = active_auction_inner_info
        .amount_in
        .saturating_sub(active_auction_inner_info.offer_price)
        .saturating_sub(init_auction_fee)
        .saturating_add(user_reward);

    // Keep track of the remaining amount in the custody token account. Whatever remains will go
    // to the executor.

    let custody_token =
        TokenAccount::try_deserialize(&mut &auction_custody_info.data.borrow()[..])?;
    let mut remaining_custodied_amount = custody_token.amount.saturating_sub(user_amount);

    // Offer price + security deposit was checked in placing the initial offer.
    let mut deposit_and_fee = active_auction_inner_info
        .offer_price
        .saturating_add(active_auction_inner_info.security_deposit)
        .saturating_sub(user_reward);

    let penalized = penalty > 0;

    if penalized && auction_best_offer_token_info.key != executor_token_info.key {
        deposit_and_fee = deposit_and_fee.saturating_sub(penalty);
    }

    // Need these seeds in order to transfer tokens and then set authority of auction custody token account to the custodian
    let auction_signer_seeds = &[
        Auction::SEED_PREFIX,
        active_auction.vaa_hash.as_ref(),
        &[active_auction.bump],
    ];

    // If the initial offer token account doesn't exist anymore, we have nowhere to send the
    // init auction fee. The executor will get these funds instead.
    //
    // We check that this is a legitimate token account.
    if utils::checked_deserialize_token_account(
        auction_initial_offer_token_info,
        &common::USDC_MINT,
    )
    .is_some()
    {
        if auction_best_offer_token_info.key() != auction_initial_offer_token_info.key() {
            // Pay the auction initiator their fee.
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &auction_custody_info.key(),
                &auction_initial_offer_token_info.key(),
                &active_auction_info.key(),
                &[],
                init_auction_fee,
            )
            .unwrap();

            invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
            // Because the initial offer token was paid this fee, we account for it here.
            remaining_custodied_amount =
                remaining_custodied_amount.saturating_sub(init_auction_fee);
        } else {
            // Add it to the reimbursement.
            deposit_and_fee = deposit_and_fee
                .checked_add(init_auction_fee)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
        }
    }

    // Return the security deposit and the fee to the highest bidder.
    if auction_best_offer_token_info.key == executor_token_info.key {
        // If the best offer token is equal to the executor token, just send whatever remains in
        // the custody token account.
        //
        // NOTE: This will revert if the best offer token does not exist. But this will present
        // an opportunity for another executor to execute this order and take what the best
        // offer token would have received.
        let transfer_ix = spl_token::instruction::transfer(
            &spl_token::ID,
            &auction_custody_info.key(),
            &auction_best_offer_token_info.key(),
            &active_auction_info.key(),
            &[],
            deposit_and_fee,
        )
        .unwrap();
        msg!(
            "Sending deposit and fee amount {} to best offer token account",
            deposit_and_fee
        );
        invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
    } else {
        // Otherwise, send the deposit and fee to the best offer token. If the best offer token
        // doesn't exist at this point (which would be unusual), we will reserve these funds
        // for the executor token.
        if utils::checked_deserialize_token_account(
            auction_best_offer_token_info,
            &common::USDC_MINT,
        )
        .is_some()
        {
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &auction_custody_info.key(),
                &auction_best_offer_token_info.key(),
                &active_auction_info.key(),
                &[],
                deposit_and_fee,
            )
            .unwrap();
            msg!(
                "Sending deposit and fee {} to best offer token account",
                deposit_and_fee
            );
            invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
            remaining_custodied_amount = remaining_custodied_amount.saturating_sub(deposit_and_fee);
        }

        // And pay the executor whatever remains in the auction custody token account.
        if remaining_custodied_amount > 0 {
            let instruction = spl_token::instruction::transfer(
                &spl_token::ID,
                auction_custody_info.key,
                executor_token_info.key,
                &active_auction_info.key(),
                &[],
                remaining_custodied_amount,
            )
            .unwrap();
            msg!(
                "Sending remaining custodied amount {} to executor token account",
                remaining_custodied_amount
            );
            invoke_signed_unchecked(&instruction, accounts, &[auction_signer_seeds])?;
        }
    }

    // Set the authority of the custody token account to the custodian. He will take over from
    // here.
    let set_authority_ix = spl_token::instruction::set_authority(
        &spl_token::ID,
        auction_custody_info.key,
        Some(custodian_info.key),
        spl_token::instruction::AuthorityType::AccountOwner,
        active_auction_info.key,
        &[],
    )
    .unwrap();

    invoke_signed_unchecked(&set_authority_ix, accounts, &[auction_signer_seeds])?;

    // Set the active auction status
    active_auction.status = AuctionStatus::Completed {
        slot: current_slot,
        execute_penalty: if penalized { penalty.into() } else { None },
    };

    let active_auction_info_data: &mut [u8] = &mut active_auction_info.data.borrow_mut();
    let mut active_auction_cursor = std::io::Cursor::new(active_auction_info_data);
    active_auction.try_serialize(&mut active_auction_cursor)?;

    let fill = Fill {
        source_chain: active_auction_inner_info.source_chain,
        order_sender: fast_market_order.sender,
        redeemer: fast_market_order.redeemer,
        redeemer_message: fast_market_order.redeemer_message
            [..usize::from(fast_market_order.redeemer_message_length)]
            .to_vec()
            .try_into()
            .unwrap(),
    };

    ////////////////////////////////////////////////////////////////////////////
    //
    // TODO: See above TODO. This is the end of the copy-pasted logic.
    //
    ////////////////////////////////////////////////////////////////////////////

    // TODO: Write test that passes in random keypair for CCTP message account
    // to show that not having to check the PDA address is safe.
    let (_, new_cctp_message_bump) = Pubkey::find_program_address(
        &[
            common::CCTP_MESSAGE_SEED_PREFIX,
            active_auction_key.as_ref(),
        ],
        &ID,
    );

    let usdc_mint_info = super::helpers::try_usdc_account(&cctp_account_infos[0])?;
    let cctp_token_messenger_minter_sender_authority_info = &cctp_account_infos[1];
    let cctp_message_transmitter_config_info = &cctp_account_infos[2];
    let cctp_token_messenger_info = &cctp_account_infos[3];
    let cctp_remote_token_messenger_info = &cctp_account_infos[4];
    let cctp_token_minter_info = &cctp_account_infos[5];
    let cctp_local_token_info = &cctp_account_infos[6];
    let cctp_token_messenger_minter_event_authority_info = &cctp_account_infos[7];
    let cctp_message_transmitter_program_info = &cctp_account_infos[8];

    let system_program_info = &accounts[29];
    let token_program_info = &accounts[30];

    burn_and_post(
        CpiContext::new_with_signer(
            cctp_token_messenger_minter_program_info.to_account_info(),
            common::wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian_info.to_account_info(),
                payer: payer_info.to_account_info(),
                token_messenger_minter_sender_authority:
                    cctp_token_messenger_minter_sender_authority_info.to_account_info(),
                burn_token: auction_custody_info.to_account_info(),
                message_transmitter_config: cctp_message_transmitter_config_info.to_account_info(),
                token_messenger: cctp_token_messenger_info.to_account_info(),
                remote_token_messenger: cctp_remote_token_messenger_info.to_account_info(),
                token_minter: cctp_token_minter_info.to_account_info(),
                local_token: cctp_local_token_info.to_account_info(),
                mint: usdc_mint_info.to_account_info(),
                cctp_message: new_cctp_message_info.to_account_info(),
                message_transmitter_program: cctp_message_transmitter_program_info
                    .to_account_info(),
                token_messenger_minter_program: cctp_token_messenger_minter_program_info
                    .to_account_info(),
                token_program: token_program_info.to_account_info(),
                system_program: system_program_info.to_account_info(),
                event_authority: cctp_token_messenger_minter_event_authority_info.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CCTP_MESSAGE_SEED_PREFIX,
                    active_auction_key.as_ref(),
                    &[new_cctp_message_bump],
                ],
            ],
        ),
        common::wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: to_endpoint.address,
            destination_cctp_domain,
            amount: user_amount,
            mint_recipient: to_endpoint.mint_recipient,
            wormhole_message_nonce: common::WORMHOLE_MESSAGE_NONCE,
            payload: fill.to_vec(),
        },
        PostMessageAccounts {
            emitter: custodian_info.key,
            payer: payer_info.key,
            message: shim_message_info.key,
            sequence: core_bridge_emitter_sequence_info.key,
        },
        accounts,
    )?;

    // Skip emitting the order executed event because we're using a shim

    // Finally close the account since it is no longer needed.
    let close_account_ix = spl_token::instruction::close_account(
        &spl_token::ID,
        auction_custody_info.key,
        auction_initial_participant_info.key,
        custodian_info.key,
        &[],
    )
    .unwrap();

    invoke_signed_unchecked(&close_account_ix, accounts, &[Custodian::SIGNER_SEEDS])
        .map_err(Into::into)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_instruction() {
        ExecuteOrderCctpShim {
            program_id: &Default::default(),
            accounts: ExecuteOrderShimAccounts {
                signer: &Default::default(),
                cctp_message: &Default::default(),
                custodian: &Default::default(),
                fast_market_order: &Default::default(),
                active_auction: &Default::default(),
                active_auction_custody_token: &Default::default(),
                active_auction_config: &Default::default(),
                active_auction_best_offer_token: &Default::default(),
                executor_token: &Default::default(),
                initial_offer_token: &Default::default(),
                initial_participant: &Default::default(),
                to_router_endpoint: &Default::default(),
                post_message_shim_program: &Default::default(),
                core_bridge_emitter_sequence: &Default::default(),
                post_shim_message: &Default::default(),
                cctp_deposit_for_burn_mint: &Default::default(),
                cctp_deposit_for_burn_token_messenger_minter_sender_authority: &Default::default(),
                cctp_deposit_for_burn_message_transmitter_config: &Default::default(),
                cctp_deposit_for_burn_token_messenger: &Default::default(),
                cctp_deposit_for_burn_remote_token_messenger: &Default::default(),
                cctp_deposit_for_burn_token_minter: &Default::default(),
                cctp_deposit_for_burn_local_token: &Default::default(),
                cctp_deposit_for_burn_token_messenger_minter_event_authority: &Default::default(),
                cctp_deposit_for_burn_token_messenger_minter_program: &Default::default(),
                cctp_deposit_for_burn_message_transmitter_program: &Default::default(),
                core_bridge_program: &Default::default(),
                core_bridge_config: &Default::default(),
                core_bridge_fee_collector: &Default::default(),
                post_message_shim_event_authority: &Default::default(),
                system_program: &Default::default(),
                token_program: &Default::default(),
                clock: &Default::default(),
            },
        }
        .instruction();
    }
}
