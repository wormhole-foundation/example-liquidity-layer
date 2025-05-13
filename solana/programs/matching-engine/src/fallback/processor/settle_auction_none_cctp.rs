use crate::ID;
use anchor_lang::{prelude::*, Discriminator};
use anchor_spl::token::{spl_token, TokenAccount};
use bytemuck::{Pod, Zeroable};
use common::wormhole_io::TypePrefixedPayload;
use solana_program::program::invoke_signed_unchecked;

use crate::{
    error::MatchingEngineError,
    events::AuctionSettled,
    processor::SettledNone,
    state::{Auction, AuctionStatus, Custodian, MessageProtocol, PreparedOrderResponse},
};

use super::{
    burn_and_post::{burn_and_post, PostMessageAccounts},
    helpers::{create_account_reliably, require_min_account_infos_len},
};

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct SettleAuctionNoneCctpShimData {
    pub cctp_message_bump: u8,
    pub auction_bump: u8,
}

pub struct SettleAuctionNoneCctpShimAccounts<'ix> {
    /// Payer of the account
    pub payer: &'ix Pubkey, // 0
    /// Post shim message account
    pub post_shim_message: &'ix Pubkey, // 1
    /// Core bridge emitter sequence account
    pub core_bridge_emitter_sequence: &'ix Pubkey, // 2
    /// Post message shim event authority
    pub post_message_shim_event_authority: &'ix Pubkey, // 3
    /// Post message shim program
    pub post_message_shim_program: &'ix Pubkey, // 4
    /// Cctp message CHECK: Seeds must be \["cctp-msg", auction.key().as_ref()\].
    pub cctp_message: &'ix Pubkey, // 5
    /// Custodian account
    pub custodian: &'ix Pubkey, // 6
    /// Fee recipient token
    pub fee_recipient_token: &'ix Pubkey, // 7
    /// Closed prepared order response actor (closed_by)
    pub closed_prepared_order_response_actor: &'ix Pubkey, // 8
    /// Closed prepared order response
    pub closed_prepared_order_response: &'ix Pubkey, // 9
    /// Closed prepared order response custody token
    pub closed_prepared_order_response_custody_token: &'ix Pubkey, // 10
    /// Auction account CHECK: Init if needed, Seeds must be \["auction", prepared.order_response.seeds.fast_vaa_hash.as_ref()\].
    pub auction: &'ix Pubkey, // 11
    /// Cctp mint (must be USDC mint)
    pub cctp_mint: &'ix Pubkey, // 12
    /// Cctp token messenger minter sender authority
    pub cctp_token_messenger_minter_sender_authority: &'ix Pubkey, // 13
    /// Cctp message transmitter config
    pub cctp_message_transmitter_config: &'ix Pubkey, // 14
    /// Cctp token messenger
    pub cctp_token_messenger: &'ix Pubkey, // 15
    /// Cctp remote token messenger
    pub cctp_remote_token_messenger: &'ix Pubkey, // 16
    /// Cctp token minter
    pub cctp_token_minter: &'ix Pubkey, // 17
    /// Cctp local token
    pub cctp_local_token: &'ix Pubkey, // 18
    /// Cctp token messenger minter event authority
    pub cctp_token_messenger_minter_event_authority: &'ix Pubkey, // 19
    /// Cctp token messenger minter program
    pub cctp_token_messenger_minter_program: &'ix Pubkey, // 20
    /// Cctp message transmitter program
    pub cctp_message_transmitter_program: &'ix Pubkey, // 21
    /// Core bridge program
    pub core_bridge_program: &'ix Pubkey, // 22
    /// Core bridge fee collector
    pub core_bridge_fee_collector: &'ix Pubkey, // 23
    /// Core bridge config
    pub core_bridge_config: &'ix Pubkey, // 24
    /// Token program
    pub token_program: &'ix Pubkey, // 25
    /// System program
    pub system_program: &'ix Pubkey, // 26
    /// Clock
    pub clock: &'ix Pubkey, // 27
    /// Rent
    pub rent: &'ix Pubkey, // 28
}

impl<'ix> SettleAuctionNoneCctpShimAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new_readonly(*self.payer, true),     // 0
            AccountMeta::new(*self.post_shim_message, false), // 1
            AccountMeta::new(*self.core_bridge_emitter_sequence, false), // 2
            AccountMeta::new_readonly(*self.post_message_shim_event_authority, false), // 3
            AccountMeta::new_readonly(*self.post_message_shim_program, false), // 4
            AccountMeta::new(*self.cctp_message, false),      // 5
            AccountMeta::new(*self.custodian, false),         // 6
            AccountMeta::new(*self.fee_recipient_token, false), // 7
            AccountMeta::new(*self.closed_prepared_order_response_actor, false), // 8
            AccountMeta::new_readonly(*self.closed_prepared_order_response, false), // 9
            AccountMeta::new(*self.closed_prepared_order_response_custody_token, false), // 10
            AccountMeta::new(*self.auction, false),           // 11
            AccountMeta::new(*self.cctp_mint, false),         // 12
            AccountMeta::new_readonly(*self.cctp_token_messenger_minter_sender_authority, false), // 13
            AccountMeta::new(*self.cctp_message_transmitter_config, false), // 14
            AccountMeta::new_readonly(*self.cctp_token_messenger, false),   // 15
            AccountMeta::new_readonly(*self.cctp_remote_token_messenger, false), // 16
            AccountMeta::new(*self.cctp_token_minter, false),               // 17
            AccountMeta::new(*self.cctp_local_token, false),                // 18
            AccountMeta::new_readonly(*self.cctp_token_messenger_minter_event_authority, false), // 19
            AccountMeta::new_readonly(*self.cctp_token_messenger_minter_program, false), // 20
            AccountMeta::new_readonly(*self.cctp_message_transmitter_program, false),    // 21
            AccountMeta::new_readonly(*self.core_bridge_program, false),                 // 22
            AccountMeta::new(*self.core_bridge_fee_collector, false),                    // 23
            AccountMeta::new(*self.core_bridge_config, false),                           // 24
            AccountMeta::new_readonly(*self.token_program, false),                       // 25
            AccountMeta::new_readonly(*self.system_program, false),                      // 26
            AccountMeta::new_readonly(*self.clock, false),                               // 27
            AccountMeta::new_readonly(*self.rent, false),                                // 28
        ]
    }
}

pub fn process(accounts: &[AccountInfo], data: &SettleAuctionNoneCctpShimData) -> Result<()> {
    let program_id = &crate::ID;
    require_min_account_infos_len(accounts, 29)?;
    let payer = &accounts[0];
    let post_shim_message = &accounts[1];
    let core_bridge_emitter_sequence = &accounts[2];
    let _post_message_shim_event_authority = &accounts[3];
    let _post_message_shim_program = &accounts[4];
    let cctp_message = &accounts[5];
    let custodian = &accounts[6];
    let fee_recipient_token = &accounts[7]; // Who is this?
    let closed_prepared_order_response_actor = &accounts[8];
    let closed_prepared_order_response = &accounts[9];
    let closed_prepared_order_response_custody_token = &accounts[10];
    let auction = &accounts[11]; // Will be created here
    let cctp_mint = &accounts[12];
    let cctp_token_messenger_minter_sender_authority = &accounts[13];
    let cctp_message_transmitter_config = &accounts[14];
    let cctp_token_messenger = &accounts[15];
    let cctp_remote_token_messenger = &accounts[16];
    let cctp_token_minter = &accounts[17];
    let cctp_local_token = &accounts[18];
    let cctp_token_messenger_minter_event_authority = &accounts[19];
    let cctp_token_messenger_minter_program = &accounts[20];
    let cctp_message_transmitter_program = &accounts[21];
    let _core_bridge_program = &accounts[22];
    let _core_bridge_fee_collector = &accounts[23];
    let _core_bridge_config = &accounts[24];
    let token_program = &accounts[25];
    let system_program = &accounts[26];
    let _clock = &accounts[27];
    let _rent = &accounts[28];

    let mut prepared_order_response_account = PreparedOrderResponse::try_deserialize(
        &mut &closed_prepared_order_response.data.borrow_mut()[..],
    )?;
    let fee_recipient_token_account =
        &TokenAccount::try_deserialize(&mut &fee_recipient_token.data.borrow_mut()[..])?;
    let prepared_custody_token_account = &TokenAccount::try_deserialize(
        &mut &closed_prepared_order_response_custody_token
            .data
            .borrow_mut()[..],
    )?;

    let to_router_endpoint = prepared_order_response_account.to_endpoint;
    let destination_cctp_domain = match to_router_endpoint.protocol {
        MessageProtocol::Cctp { domain } => domain,
        _ => return Err(MatchingEngineError::InvalidCctpEndpoint.into()),
    };

    let auction_key = auction.key();

    // Start of checks
    // ------------------------------------------------------------------------------------------------

    // Check cctp message is writable
    if !cctp_message.is_writable {
        msg!("Cctp message is not writable");
        return Err(MatchingEngineError::AccountNotWritable.into())
            .map_err(|e: Error| e.with_account_name("cctp_message"));
    }

    // Check cctp message seeds are valid
    let cctp_message_seeds = [
        common::CCTP_MESSAGE_SEED_PREFIX,
        auction_key.as_ref(),
        &[data.cctp_message_bump],
    ];

    let cctp_message_pda = Pubkey::create_program_address(&cctp_message_seeds, &ID)
        .map_err(|_| MatchingEngineError::InvalidPda)?;
    if cctp_message_pda != cctp_message.key() {
        msg!("Cctp message seeds are invalid");
        return Err(ErrorCode::ConstraintSeeds.into())
            .map_err(|e: Error| e.with_pubkeys((cctp_message_pda, cctp_message.key())));
    };
    // Check custodian owner is the matching engine program and that it deserializes into a checked custodian
    require_eq!(custodian.owner, &ID);
    let checked_custodian = Custodian::try_deserialize(&mut &custodian.data.borrow_mut()[..])?;
    // Check that the fee recipient token is the custodian's fee recipient token
    require_eq!(
        fee_recipient_token.key(),
        checked_custodian.fee_recipient_token
    );

    // Check seeds of prepared order response are valid
    let prepared_order_response_pda = Pubkey::create_program_address(
        &[
            PreparedOrderResponse::SEED_PREFIX,
            prepared_order_response_account.seeds.fast_vaa_hash.as_ref(),
            &[prepared_order_response_account.seeds.bump],
        ],
        program_id,
    )
    .map_err(|_| MatchingEngineError::InvalidPda)?;
    if prepared_order_response_pda != closed_prepared_order_response.key() {
        msg!("Prepared order response seeds are invalid");
        return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
            e.with_pubkeys((
                prepared_order_response_pda,
                closed_prepared_order_response.key(),
            ))
        });
    };
    // Check seeds of prepared custody token are valid
    {
        let (prepared_custody_token_pda, _) = Pubkey::find_program_address(
            &[
                crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
                closed_prepared_order_response.key().as_ref(),
            ],
            program_id,
        );
        if prepared_custody_token_pda != closed_prepared_order_response_custody_token.key() {
            msg!("Prepared custody token seeds are invalid");
            return Err(ErrorCode::ConstraintSeeds.into()).map_err(|e: Error| {
                e.with_pubkeys((
                    prepared_custody_token_pda,
                    closed_prepared_order_response_custody_token.key(),
                ))
            });
        };
    }

    // Check prepared by is the same as the prepared by in the accounts
    require_eq!(
        prepared_order_response_account.prepared_by,
        closed_prepared_order_response_actor.key()
    );

    // Check that custody token is a token account
    let _checked_prepared_custody_token = Box::new(TokenAccount::try_deserialize(
        &mut &closed_prepared_order_response_custody_token
            .data
            .borrow_mut()[..],
    )?);
    // Check seeds of auction are valid
    let auction_seeds = [
        Auction::SEED_PREFIX,
        prepared_order_response_account.seeds.fast_vaa_hash.as_ref(),
        &[data.auction_bump],
    ];
    let auction_pda = Pubkey::create_program_address(&auction_seeds, program_id)
        .map_err(|_| MatchingEngineError::InvalidPda)?;
    if auction_pda != auction.key() {
        return Err(MatchingEngineError::InvalidPda.into());
    }

    // End of checks
    // ------------------------------------------------------------------------------------------------

    // Begin of initialisation of auction account
    // ------------------------------------------------------------------------------------------------
    let auction_space = 8 + Auction::INIT_SPACE_NO_AUCTION;

    let auction_signer_seeds = &[&auction_seeds[..]];
    create_account_reliably(
        &payer.key(),
        &auction.key(),
        auction.lamports(),
        auction_space,
        accounts,
        program_id,
        auction_signer_seeds,
    )?;
    // Borrow the account data mutably
    let mut auction_data = auction
        .try_borrow_mut_data()
        .map_err(|_| MatchingEngineError::AccountNotWritable)?;
    // Write the discriminator to the first 8 bytes
    let discriminator = Auction::discriminator();
    auction_data[0..8].copy_from_slice(&discriminator);
    let mut auction_to_write =
        prepared_order_response_account.new_auction_placeholder(data.auction_bump);
    let prepare_none_and_settle_fill_pubkeys = PrepareNoneAndSettleFillPubkeys {
        prepared_order_response_key: &closed_prepared_order_response.key(),
        prepared_order_response_custody_token: &closed_prepared_order_response_custody_token.key(),
        fee_recipient_token_key: &fee_recipient_token.key(),
        custodian_key: &custodian.key(),
    };
    let SettledNone {
        user_amount,
        fill,
        auction_settled_event: _,
    } = prepare_none_and_settle_fill(
        prepare_none_and_settle_fill_pubkeys,
        &mut prepared_order_response_account,
        &mut auction_to_write,
        fee_recipient_token_account,
        prepared_custody_token_account,
        accounts,
    )?;
    let auction_bytes = auction_to_write
        .try_to_vec()
        .map_err(|_| MatchingEngineError::BorshDeserializationError)?;
    auction_data[8..8_usize.saturating_add(auction_bytes.len())].copy_from_slice(&auction_bytes);
    // ------------------------------------------------------------------------------------------------
    // End of initialisation of auction account

    // Begin of burning and posting the message
    // ------------------------------------------------------------------------------------------------
    let post_message_accounts = PostMessageAccounts {
        emitter: custodian.key,
        payer: payer.key,
        message: post_shim_message.key,
        sequence: core_bridge_emitter_sequence.key,
    };
    burn_and_post(
        CpiContext::new_with_signer(
            cctp_token_messenger_minter_program.to_account_info(),
            common::wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian.to_account_info(),
                payer: payer.to_account_info(),
                token_messenger_minter_sender_authority:
                    cctp_token_messenger_minter_sender_authority.to_account_info(),
                burn_token: closed_prepared_order_response_custody_token.to_account_info(),
                message_transmitter_config: cctp_message_transmitter_config.to_account_info(),
                token_messenger: cctp_token_messenger.to_account_info(),
                remote_token_messenger: cctp_remote_token_messenger.to_account_info(),
                token_minter: cctp_token_minter.to_account_info(),
                local_token: cctp_local_token.to_account_info(),
                mint: cctp_mint.to_account_info(),
                cctp_message: cctp_message.to_account_info(),
                message_transmitter_program: cctp_message_transmitter_program.to_account_info(),
                token_messenger_minter_program: cctp_token_messenger_minter_program
                    .to_account_info(),
                token_program: token_program.to_account_info(),
                system_program: system_program.to_account_info(),
                event_authority: cctp_token_messenger_minter_event_authority.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CCTP_MESSAGE_SEED_PREFIX,
                    auction.key().as_ref(),
                    &[data.cctp_message_bump],
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
    // ------------------------------------------------------------------------------------------------
    // End of burning and posting the message

    // Begin of closing the prepared order response
    // ------------------------------------------------------------------------------------------------
    let close_token_account_ix = spl_token::instruction::close_account(
        &spl_token::ID,
        &closed_prepared_order_response_custody_token.key(),
        &closed_prepared_order_response_actor.key(),
        &custodian.key(),
        &[],
    )?;
    invoke_signed_unchecked(
        &close_token_account_ix,
        accounts,
        &[&Custodian::SIGNER_SEEDS],
    )?;
    // ------------------------------------------------------------------------------------------------
    // End of closing the prepared order response

    Ok(())
}

struct PrepareNoneAndSettleFillPubkeys<'ix> {
    prepared_order_response_key: &'ix Pubkey,
    prepared_order_response_custody_token: &'ix Pubkey,
    fee_recipient_token_key: &'ix Pubkey,
    custodian_key: &'ix Pubkey,
}

// Rewrite of settle_none_and_prepare_fill
fn prepare_none_and_settle_fill<'ix>(
    pubkeys: PrepareNoneAndSettleFillPubkeys<'ix>,
    prepared_order_response: &'ix mut PreparedOrderResponse,
    auction: &mut Auction,
    fee_recipient_token: &'ix TokenAccount,
    prepared_custody_token: &'ix TokenAccount,
    accounts: &[AccountInfo],
) -> Result<SettledNone> {
    let PrepareNoneAndSettleFillPubkeys {
        prepared_order_response_key,
        prepared_order_response_custody_token,
        fee_recipient_token_key,
        custodian_key,
    } = pubkeys;
    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        prepared_order_response.seeds.fast_vaa_hash.as_ref(),
        &[prepared_order_response.seeds.bump],
    ];
    // Pay the `fee_recipient` the base fee and init auction fee. This ensures that the protocol
    // relayer is paid for relaying slow VAAs (which requires posting the fast order VAA) that do
    // not have an associated auction.
    let fee = prepared_order_response
        .base_fee
        .saturating_add(prepared_order_response.init_auction_fee);

    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        prepared_order_response_custody_token,
        fee_recipient_token_key,
        prepared_order_response_key,
        &[],
        fee,
    )?;

    invoke_signed_unchecked(
        &transfer_ix,
        accounts,
        &[prepared_order_response_signer_seeds],
    )?;

    // Set authority instruction
    let set_authority_ix = spl_token::instruction::set_authority(
        &spl_token::ID,
        prepared_order_response_custody_token,
        Some(custodian_key),
        spl_token::instruction::AuthorityType::AccountOwner,
        prepared_order_response_key,
        &[],
    )?;

    invoke_signed_unchecked(
        &set_authority_ix,
        accounts,
        &[prepared_order_response_signer_seeds],
    )?;

    auction.status = AuctionStatus::Settled {
        fee,
        total_penalty: None,
    };

    let auction_settled_event = AuctionSettled {
        fast_vaa_hash: auction.vaa_hash,
        best_offer_token: Default::default(),
        base_fee_token: crate::events::SettledTokenAccountInfo {
            key: *fee_recipient_token_key,
            balance_after: fee_recipient_token.amount.saturating_add(fee),
        }
        .into(),
        with_execute: auction.target_protocol.into(),
    };
    // TryInto is safe to unwrap here because the redeemer message had to have been able to fit in
    // the prepared order response account (so it would not have exceed u32::MAX).
    let redeemer_message = std::mem::take(&mut prepared_order_response.redeemer_message)
        .try_into()
        .unwrap();
    Ok(SettledNone {
        user_amount: prepared_custody_token.amount.saturating_sub(fee),
        fill: common::messages::Fill {
            source_chain: prepared_order_response.source_chain,
            order_sender: prepared_order_response.sender,
            redeemer: prepared_order_response.redeemer,
            redeemer_message,
        },
        auction_settled_event,
    })
}
