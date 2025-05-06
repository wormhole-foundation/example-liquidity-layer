use crate::fallback::burn_and_post::PostMessageDerivedAccounts;
use crate::fallback::helpers::*;
use crate::state::{
    Auction, AuctionConfig, AuctionStatus, Custodian, FastMarketOrder as FastMarketOrderState,
    MessageProtocol, RouterEndpoint,
};
use crate::utils::auction::DepositPenalty;
use crate::{utils, ID};
use anchor_lang::prelude::*;
use anchor_spl::token::{spl_token, TokenAccount};
use common::messages::Fill;
use common::wormhole_io::TypePrefixedPayload;
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed_unchecked;

use super::burn_and_post::{burn_and_post, PostMessageAccounts};
use super::FallbackMatchingEngineInstruction;
use crate::error::MatchingEngineError;

#[derive(Debug, Clone, PartialEq, Eq, Copy)]
pub struct ExecuteOrderShimAccounts<'ix> {
    /// The signer account
    pub signer: &'ix Pubkey, // 0
    /// The cctp message account. CHECK: Seeds must be \["cctp-msg", auction_address.as_ref()\].
    pub cctp_message: &'ix Pubkey, // 1
    /// The custodian account of the auction (holds the best offer amount)
    pub custodian: &'ix Pubkey, // 2
    /// The fast market order account created from the place initial offer instruction
    /// CHECK: Seeds must be \["fast_market_order", auction_address.as_ref()\].
    pub fast_market_order: &'ix Pubkey, // 3
    /// The auction account created from the place initial offer instruction
    pub active_auction: &'ix Pubkey, // 4
    /// The associated token address of the auction's custody token
    pub active_auction_custody_token: &'ix Pubkey, // 5
    /// The auction config account created from the place initial offer instruction
    pub active_auction_config: &'ix Pubkey, // 6
    /// The token account of the auction's best offer
    pub active_auction_best_offer_token: &'ix Pubkey, // 7
    /// The token account of the executor
    pub executor_token: &'ix Pubkey, // 8
    /// The token account of the auction's initial offer
    pub initial_offer_token: &'ix Pubkey, // 9
    /// The account that signed the creation of the auction when placing the initial offer.
    pub initial_participant: &'ix Pubkey, // 10
    /// The router endpoint account of the auction's target chain
    pub to_router_endpoint: &'ix Pubkey, // 11
    /// The program id of the post message shim program
    pub post_message_shim_program: &'ix Pubkey, // 12
    /// The emitter sequence of the core bridge program (can be derived)
    pub core_bridge_emitter_sequence: &'ix Pubkey, // 13
    /// The message account of the post message shim program (can be derived)
    pub post_shim_message: &'ix Pubkey, // 14
    /// The mint account of the CCTP token to be burned
    pub cctp_deposit_for_burn_mint: &'ix Pubkey, // 15
    /// The token messenger minter sender authority account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger_minter_sender_authority: &'ix Pubkey, // 16
    /// The message transmitter config account of the CCTP token to be burned
    pub cctp_deposit_for_burn_message_transmitter_config: &'ix Pubkey, // 17
    /// The token messenger account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger: &'ix Pubkey, // 18
    /// The remote token messenger account of the CCTP token to be burned
    pub cctp_deposit_for_burn_remote_token_messenger: &'ix Pubkey, // 19
    /// The token minter account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_minter: &'ix Pubkey, // 20
    /// The local token account of the CCTP token to be burned
    pub cctp_deposit_for_burn_local_token: &'ix Pubkey, // 21
    /// The token messenger minter event authority account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger_minter_event_authority: &'ix Pubkey, // 22
    /// The token messenger minter program account of the CCTP token to be burned
    pub cctp_deposit_for_burn_token_messenger_minter_program: &'ix Pubkey, // 23
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
    pub system_program: &'ix Pubkey, // 29
    /// The program id of the token program
    pub token_program: &'ix Pubkey, // 30
    /// The clock account
    pub clock: &'ix Pubkey, // 31
}

impl<'ix> ExecuteOrderShimAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.signer, true),
            AccountMeta::new(*self.cctp_message, false),
            AccountMeta::new(*self.custodian, false),
            AccountMeta::new_readonly(*self.fast_market_order, false),
            AccountMeta::new(*self.active_auction, false),
            AccountMeta::new(*self.active_auction_custody_token, false),
            AccountMeta::new_readonly(*self.active_auction_config, false),
            AccountMeta::new(*self.active_auction_best_offer_token, false),
            AccountMeta::new(*self.executor_token, false),
            AccountMeta::new(*self.initial_offer_token, false),
            AccountMeta::new(*self.initial_participant, false),
            AccountMeta::new_readonly(*self.to_router_endpoint, false),
            AccountMeta::new_readonly(*self.post_message_shim_program, false),
            AccountMeta::new(*self.core_bridge_emitter_sequence, false),
            AccountMeta::new(*self.post_shim_message, false),
            AccountMeta::new(*self.cctp_deposit_for_burn_mint, false),
            AccountMeta::new_readonly(
                *self.cctp_deposit_for_burn_token_messenger_minter_sender_authority,
                false,
            ),
            AccountMeta::new(
                *self.cctp_deposit_for_burn_message_transmitter_config,
                false,
            ),
            AccountMeta::new_readonly(*self.cctp_deposit_for_burn_token_messenger, false),
            AccountMeta::new_readonly(*self.cctp_deposit_for_burn_remote_token_messenger, false),
            AccountMeta::new_readonly(*self.cctp_deposit_for_burn_token_minter, false),
            AccountMeta::new(*self.cctp_deposit_for_burn_local_token, false),
            AccountMeta::new_readonly(
                *self.cctp_deposit_for_burn_token_messenger_minter_event_authority,
                false,
            ),
            AccountMeta::new_readonly(
                *self.cctp_deposit_for_burn_token_messenger_minter_program,
                false,
            ),
            AccountMeta::new_readonly(
                *self.cctp_deposit_for_burn_message_transmitter_program,
                false,
            ),
            AccountMeta::new_readonly(*self.core_bridge_program, false),
            AccountMeta::new(*self.core_bridge_config, false),
            AccountMeta::new(*self.core_bridge_fee_collector, false),
            AccountMeta::new(*self.post_message_shim_event_authority, false),
            AccountMeta::new_readonly(*self.system_program, false),
            AccountMeta::new_readonly(*self.token_program, false),
            AccountMeta::new_readonly(*self.clock, false),
        ]
    }
}

pub struct ExecuteOrderCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: ExecuteOrderShimAccounts<'ix>,
}

impl ExecuteOrderCctpShim<'_> {
    pub fn instruction(&self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: FallbackMatchingEngineInstruction::ExecuteOrderCctpShim.to_vec(),
        }
    }
}

pub fn handle_execute_order_shim(accounts: &[AccountInfo]) -> Result<()> {
    // This saves stack space whereas having that in the body does not
    require_min_account_infos_len(accounts, 31)?;

    // Get the accounts
    let signer_account = &accounts[0];
    let cctp_message_account = &accounts[1];
    let custodian_account = &accounts[2];
    let fast_market_order_account = &accounts[3];
    let active_auction_account = &accounts[4];
    let active_auction_custody_token_account = &accounts[5];
    let active_auction_config_account = &accounts[6];
    let active_auction_best_offer_token_account = &accounts[7];
    let executor_token_account = &accounts[8];
    let initial_offer_token_account = &accounts[9];
    let initial_participant_account = &accounts[10];
    let to_router_endpoint_account = &accounts[11];
    let _post_message_shim_program_account = &accounts[12];
    let core_bridge_emitter_sequence_account = &accounts[13];
    let post_shim_message_account = &accounts[14];
    let cctp_deposit_for_burn_mint_account = &accounts[15];
    let cctp_deposit_for_burn_token_messenger_minter_sender_authority_account = &accounts[16];
    let cctp_deposit_for_burn_message_transmitter_config_account = &accounts[17];
    let cctp_deposit_for_burn_token_messenger_account = &accounts[18];
    let cctp_deposit_for_burn_remote_token_messenger_account = &accounts[19];
    let cctp_deposit_for_burn_token_minter_account = &accounts[20];
    let cctp_deposit_for_burn_local_token_account = &accounts[21];
    let cctp_deposit_for_burn_token_messenger_minter_event_authority_account = &accounts[22];
    let cctp_deposit_for_burn_token_messenger_minter_program_account = &accounts[23];
    let cctp_deposit_for_burn_message_transmitter_program_account = &accounts[24];
    let _core_bridge_program_account = &accounts[25];
    let _core_bridge_config_account = &accounts[26];
    let _core_bridge_fee_collector_account = &accounts[27];
    let _post_message_shim_event_authority_account = &accounts[28];
    let system_program_account = &accounts[29];
    let token_program_account = &accounts[30];

    // Do checks
    // ------------------------------------------------------------------------------------------------

    let fast_market_order_data = &fast_market_order_account.data.borrow()[..];
    let fast_market_order_zero_copy = FastMarketOrderState::try_read(fast_market_order_data)?;
    // Bind value for compiler (needed for pda seeds)
    let active_auction_key = active_auction_account.key();

    // Check cctp message is mutable
    if !cctp_message_account.is_writable {
        msg!("Cctp message is not writable");
        return Err(MatchingEngineError::AccountNotWritable.into())
            .map_err(|e: Error| e.with_account_name("cctp_message"));
    }

    // Check cctp message seeds
    let cctp_message_seeds = [
        common::CCTP_MESSAGE_SEED_PREFIX,
        active_auction_key.as_ref(),
    ];

    let (cctp_message_pda, cctp_message_bump) =
        Pubkey::find_program_address(&cctp_message_seeds, &ID);
    if cctp_message_pda != cctp_message_account.key() {
        msg!("Cctp message seeds are invalid");
        return Err(ErrorCode::ConstraintSeeds.into())
            .map_err(|e: Error| e.with_pubkeys((cctp_message_pda, cctp_message_account.key())));
    };

    // Check custodian owner
    check_custodian_owner_is_program_id(custodian_account)?;

    // Check custodian deserialises into a checked custodian account
    let _checked_custodian = Custodian::try_deserialize(&mut &custodian_account.data.borrow()[..])?;

    let fast_market_order_digest = fast_market_order_zero_copy.digest();
    // Check fast market order seeds
    let fast_market_order_seeds = [
        FastMarketOrderState::SEED_PREFIX,
        fast_market_order_digest.as_ref(),
        fast_market_order_zero_copy
            .close_account_refund_recipient
            .as_ref(),
    ];

    let (fast_market_order_pda, _fast_market_order_bump) =
        Pubkey::find_program_address(&fast_market_order_seeds, &ID);
    if fast_market_order_pda != fast_market_order_account.key() {
        msg!("Fast market order seeds are invalid");
        return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
            e.with_pubkeys((fast_market_order_pda, fast_market_order_account.key()))
        });
    };

    // Check fast market order is owned by the matching engine program
    if fast_market_order_account.owner != &ID {
        msg!("Fast market order is not owned by the matching engine program");
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("fast_market_order"));
    };

    // Check active auction owner
    if active_auction_account.owner != &ID {
        msg!("Active auction is not owned by the matching engine program");
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("active_auction"));
    };

    // Check active auction pda
    let mut active_auction =
        Auction::try_deserialize(&mut &active_auction_account.data.borrow()[..])?;

    require!(
        fast_market_order_digest == active_auction.vaa_hash,
        MatchingEngineError::VaaMismatch
    );

    // Correct way to use create_program_address with existing seeds and bump
    let active_auction_pda = Pubkey::create_program_address(
        &[
            Auction::SEED_PREFIX,
            active_auction.vaa_hash.as_ref(),
            &[active_auction.bump],
        ],
        &ID,
    )
    .map_err(|_| {
        msg!("Failed to create program address with known bump");
        MatchingEngineError::InvalidPda
    })?;
    if active_auction_pda != active_auction_account.key() {
        msg!("Active auction pda is invalid");
        return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
            e.with_pubkeys((active_auction_pda, active_auction_account.key()))
        });
    };

    // Check active auction is active
    if active_auction.status != AuctionStatus::Active {
        msg!("Active auction is not active");
        return Err(ErrorCode::ConstraintRaw.into())
            .map_err(|e: Error| e.with_account_name("active_auction"));
    };

    // Check active auction custody token pda
    let active_auction_custody_token_pda = Pubkey::create_program_address(
        &[
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            active_auction_account.key().as_ref(),
            &[active_auction.info.as_ref().unwrap().custody_token_bump],
        ],
        &ID,
    )
    .map_err(|_| {
        msg!("Failed to create program address with known bump");
        MatchingEngineError::InvalidPda
    })?;
    if active_auction_custody_token_pda != active_auction_custody_token_account.key() {
        msg!("Active auction custody token pda is invalid");
        return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
            e.with_pubkeys((
                active_auction_custody_token_pda,
                active_auction_custody_token_account.key(),
            ))
        });
    };

    // Check active auction config id
    let active_auction_config =
        AuctionConfig::try_deserialize(&mut &active_auction_config_account.data.borrow()[..])?;
    if active_auction_config.id != active_auction.info.as_ref().unwrap().config_id {
        msg!("Active auction config id is invalid");
        return Err(MatchingEngineError::AuctionConfigMismatch.into())
            .map_err(|e: Error| e.with_account_name("active_auction_config"));
    };

    // Check that the auction has reached its deadline
    let auction_info = active_auction.info.as_ref().unwrap();
    if auction_info.within_auction_duration(&active_auction_config.parameters) {
        msg!("Auction has not reached its deadline");
        return Err(MatchingEngineError::AuctionPeriodNotExpired.into())
            .map_err(|e: Error| e.with_account_name("active_auction"));
    }

    // Check active auction best offer token address
    if active_auction_best_offer_token_account.key()
        != active_auction.info.as_ref().unwrap().best_offer_token
    {
        msg!("Active auction best offer token address is invalid");
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_pubkeys((
                active_auction_best_offer_token_account.key(),
                active_auction.info.as_ref().unwrap().best_offer_token,
            ))
        });
    };

    // Check initial offer token address
    if initial_offer_token_account.key()
        != active_auction.info.as_ref().unwrap().initial_offer_token
    {
        msg!("Initial offer token address is invalid");
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_pubkeys((
                initial_offer_token_account.key(),
                active_auction.info.as_ref().unwrap().initial_offer_token,
            ))
        });
    };

    // Check initial participant address
    if initial_participant_account.key() != active_auction.prepared_by {
        msg!("Initial participant address is invalid");
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_pubkeys((
                initial_participant_account.key(),
                active_auction.prepared_by,
            ))
        });
    };

    let to_router_endpoint =
        RouterEndpoint::try_deserialize(&mut &to_router_endpoint_account.data.borrow()[..])?;
    if to_router_endpoint.protocol != active_auction.target_protocol {
        msg!("To router endpoint protocol is invalid");
        return Err(MatchingEngineError::InvalidEndpoint.into())
            .map_err(|e: Error| e.with_account_name("to_router_endpoint"));
    };

    let destination_cctp_domain = match to_router_endpoint.protocol {
        MessageProtocol::Cctp { domain } => domain,
        _ => {
            return Err(MatchingEngineError::InvalidCctpEndpoint.into())
                .map_err(|e: Error| e.with_account_name("to_router_endpoint"))
        }
    };

    // Check cctp deposit for burn token messenger minter program address
    if cctp_deposit_for_burn_token_messenger_minter_program_account.key()
        != common::wormhole_cctp_solana::cctp::token_messenger_minter_program::id()
    {
        msg!("Cctp deposit for burn token messenger minter program address is invalid");
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_pubkeys((
                cctp_deposit_for_burn_token_messenger_minter_program_account.key(),
                common::wormhole_cctp_solana::cctp::token_messenger_minter_program::id(),
            ))
        });
    };

    // Check cctp deposit for burn message transmitter program address
    if cctp_deposit_for_burn_message_transmitter_program_account.key()
        != common::wormhole_cctp_solana::cctp::message_transmitter_program::id()
    {
        msg!("Cctp deposit for burn message transmitter program address is invalid");
        return Err(ErrorCode::ConstraintAddress.into()).map_err(|e: Error| {
            e.with_pubkeys((
                cctp_deposit_for_burn_message_transmitter_program_account.key(),
                common::wormhole_cctp_solana::cctp::message_transmitter_program::id(),
            ))
        });
    };

    // End of checks
    // ------------------------------------------------------------------------------------------------

    // Get the fast market order data, without the discriminator
    let fast_market_order_data = &fast_market_order_account.data.borrow()[8..];
    // Deserialise fast market order. Unwrap is safe because the account is owned by the matching engine program.
    let fast_market_order =
        bytemuck::try_from_bytes::<FastMarketOrderState>(fast_market_order_data).unwrap();

    // Prepare the execute order (get the user amount, fill, and order executed event)
    let active_auction_info = active_auction.info.as_ref().unwrap();
    let current_slot = Clock::get().unwrap().slot;

    // We extend the grace period for locally executed orders. Reserving a sequence number for
    // the fast fill will most likely require an additional transaction, so this buffer allows
    // the best offer participant to perform his duty without the risk of getting slashed by
    // another executor.
    let additional_grace_period = Some(crate::EXECUTE_FAST_ORDER_LOCAL_ADDITIONAL_GRACE_PERIOD);

    let DepositPenalty {
        penalty,
        user_reward,
    } = utils::auction::compute_deposit_penalty(
        &active_auction_config.parameters,
        active_auction_info,
        current_slot,
        additional_grace_period,
    );

    let init_auction_fee = fast_market_order.init_auction_fee;

    let user_amount = active_auction_info
        .amount_in
        .saturating_sub(active_auction_info.offer_price)
        .saturating_sub(init_auction_fee)
        .saturating_add(user_reward);

    // Keep track of the remaining amount in the custody token account. Whatever remains will go
    // to the executor.

    let custody_token = TokenAccount::try_deserialize(
        &mut &active_auction_custody_token_account.data.borrow()[..],
    )?;
    let mut remaining_custodied_amount = custody_token.amount.saturating_sub(user_amount);

    // Offer price + security deposit was checked in placing the initial offer.
    let mut deposit_and_fee = active_auction_info
        .offer_price
        .saturating_add(active_auction_info.security_deposit)
        .saturating_sub(user_reward);

    msg!("Security deposit: {}", active_auction_info.security_deposit);

    let penalized = penalty > 0;

    if penalized && active_auction_best_offer_token_account.key() != executor_token_account.key() {
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
    if utils::checked_deserialize_token_account(initial_offer_token_account, &common::USDC_MINT)
        .is_some()
    {
        msg!("Initial offer token account exists");
        if active_auction_best_offer_token_account.key() != initial_offer_token_account.key() {
            // Pay the auction initiator their fee.
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &active_auction_custody_token_account.key(),
                &initial_offer_token_account.key(),
                &active_auction_account.key(),
                &[],
                init_auction_fee,
            )
            .unwrap();
            msg!(
                "Sending init auction fee {} to initial offer token account",
                init_auction_fee
            );
            invoke_signed_unchecked(&transfer_ix, accounts, &[auction_signer_seeds])?;
            // Because the initial offer token was paid this fee, we account for it here.
            remaining_custodied_amount =
                remaining_custodied_amount.saturating_sub(init_auction_fee);
        } else {
            // Add it to the reimbursement.
            deposit_and_fee = deposit_and_fee
                .checked_add(init_auction_fee)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
            msg!("New deposit and fee: {}", deposit_and_fee);
        }
    }

    // Return the security deposit and the fee to the highest bidder.
    if active_auction_best_offer_token_account.key() == executor_token_account.key() {
        // If the best offer token is equal to the executor token, just send whatever remains in
        // the custody token account.
        //
        // NOTE: This will revert if the best offer token does not exist. But this will present
        // an opportunity for another executor to execute this order and take what the best
        // offer token would have received.
        let transfer_ix = spl_token::instruction::transfer(
            &spl_token::ID,
            &active_auction_custody_token_account.key(),
            &active_auction_best_offer_token_account.key(),
            &active_auction_account.key(),
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
            active_auction_best_offer_token_account,
            &common::USDC_MINT,
        )
        .is_some()
        {
            let transfer_ix = spl_token::instruction::transfer(
                &spl_token::ID,
                &active_auction_custody_token_account.key(),
                &active_auction_best_offer_token_account.key(),
                &active_auction_account.key(),
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
                &active_auction_custody_token_account.key(),
                &executor_token_account.key(),
                &active_auction_account.key(),
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
        &active_auction_custody_token_account.key(),
        Some(&custodian_account.key()),
        spl_token::instruction::AuthorityType::AccountOwner,
        &active_auction_account.key(),
        &[],
    )
    .unwrap();

    invoke_signed_unchecked(&set_authority_ix, accounts, &[auction_signer_seeds])?;

    // Set the active auction status
    active_auction.status = AuctionStatus::Completed {
        slot: current_slot,
        execute_penalty: if penalized { penalty.into() } else { None },
    };

    let active_auction_data: &mut [u8] = &mut active_auction_account.data.borrow_mut();
    let mut cursor = std::io::Cursor::new(active_auction_data);
    active_auction.try_serialize(&mut cursor).unwrap();

    let fill = Fill {
        source_chain: active_auction_info.source_chain,
        order_sender: fast_market_order.sender,
        redeemer: fast_market_order.redeemer,
        redeemer_message: fast_market_order.redeemer_message
            [..usize::from(fast_market_order.redeemer_message_length)]
            .to_vec()
            .try_into()
            .unwrap(),
    };

    let post_message_accounts = PostMessageAccounts {
        emitter: custodian_account.key(),
        payer: signer_account.key(),
        derived: PostMessageDerivedAccounts {
            message: post_shim_message_account.key(),
            sequence: core_bridge_emitter_sequence_account.key(),
        },
    };

    burn_and_post(
        CpiContext::new_with_signer(
            cctp_deposit_for_burn_token_messenger_minter_program_account.to_account_info(),
            common::wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian_account.to_account_info(),
                payer: signer_account.to_account_info(),
                token_messenger_minter_sender_authority:
                    cctp_deposit_for_burn_token_messenger_minter_sender_authority_account
                        .to_account_info(),
                burn_token: active_auction_custody_token_account.to_account_info(),
                message_transmitter_config:
                    cctp_deposit_for_burn_message_transmitter_config_account.to_account_info(),
                token_messenger: cctp_deposit_for_burn_token_messenger_account.to_account_info(),
                remote_token_messenger: cctp_deposit_for_burn_remote_token_messenger_account
                    .to_account_info(),
                token_minter: cctp_deposit_for_burn_token_minter_account.to_account_info(),
                local_token: cctp_deposit_for_burn_local_token_account.to_account_info(),
                mint: cctp_deposit_for_burn_mint_account.to_account_info(),
                cctp_message: cctp_message_account.to_account_info(),
                message_transmitter_program:
                    cctp_deposit_for_burn_message_transmitter_program_account.to_account_info(),
                token_messenger_minter_program:
                    cctp_deposit_for_burn_token_messenger_minter_program_account.to_account_info(),
                token_program: token_program_account.to_account_info(),
                system_program: system_program_account.to_account_info(),
                event_authority:
                    cctp_deposit_for_burn_token_messenger_minter_event_authority_account
                        .to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CCTP_MESSAGE_SEED_PREFIX,
                    active_auction_account.key().as_ref(),
                    &[cctp_message_bump],
                ],
            ],
        ),
        common::wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: to_router_endpoint.address,
            destination_cctp_domain,
            amount: user_amount,
            mint_recipient: to_router_endpoint.mint_recipient,
            wormhole_message_nonce: common::WORMHOLE_MESSAGE_NONCE,
            payload: fill.to_vec(),
        },
        post_message_accounts,
        accounts,
    )?;

    // Skip emitting the order executed event because we're using a shim

    // Finally close the account since it is no longer needed.
    let instruction = spl_token::instruction::close_account(
        &spl_token::ID,
        &active_auction_custody_token_account.key(),
        &initial_participant_account.key(),
        &custodian_account.key(),
        &[],
    )
    .unwrap();

    invoke_signed_unchecked(&instruction, accounts, &[Custodian::SIGNER_SEEDS])?;

    Ok(())
}
