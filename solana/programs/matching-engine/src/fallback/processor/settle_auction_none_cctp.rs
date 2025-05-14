use crate::{
    processor::{settle_none_and_prepare_fill, SettleNoneAndPrepareFill},
    ID,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{spl_token, TokenAccount};
use bytemuck::{Pod, Zeroable};
use common::wormhole_io::TypePrefixedPayload;
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed_unchecked;

use crate::{
    error::MatchingEngineError,
    processor::SettledNone,
    state::{Auction, Custodian, MessageProtocol, PreparedOrderResponse},
};

use super::{
    burn_and_post::{burn_and_post, PostMessageAccounts},
    helpers::{create_account_reliably, require_min_account_infos_len},
    FallbackMatchingEngineInstruction,
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
    /// Custodian account
    pub custodian: &'ix Pubkey, // 5
    /// Fee recipient token
    pub fee_recipient_token: &'ix Pubkey, // 6
    /// Closed prepared order response
    pub closed_prepared_order_response: &'ix Pubkey, // 7
    /// Closed prepared order response actor (closed_by)
    pub closed_prepared_order_response_actor: &'ix Pubkey, // 8
    /// Closed prepared order response custody token
    pub closed_prepared_order_response_custody_token: &'ix Pubkey, // 9
    /// Auction account CHECK: Init if needed, Seeds must be \["auction", prepared.order_response.seeds.fast_vaa_hash.as_ref()\].
    pub auction: &'ix Pubkey, // 10
    /// Cctp message CHECK: Seeds must be \["cctp-msg", auction.key().as_ref()\].
    pub cctp_message: &'ix Pubkey, // 11
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

pub struct SettleAuctionNoneCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: SettleAuctionNoneCctpShimAccounts<'ix>,
    pub data: SettleAuctionNoneCctpShimData,
}

impl<'ix> SettleAuctionNoneCctpShim<'ix> {
    pub fn instruction(self) -> Instruction {
        let SettleAuctionNoneCctpShimAccounts {
            payer,
            post_shim_message,
            core_bridge_emitter_sequence,
            post_message_shim_event_authority,
            post_message_shim_program,
            cctp_message,
            custodian,
            fee_recipient_token,
            closed_prepared_order_response,
            closed_prepared_order_response_actor,
            closed_prepared_order_response_custody_token,
            auction,
            cctp_mint,
            cctp_token_messenger_minter_sender_authority,
            cctp_message_transmitter_config,
            cctp_token_messenger,
            cctp_remote_token_messenger,
            cctp_token_minter,
            cctp_local_token,
            cctp_token_messenger_minter_event_authority,
            cctp_token_messenger_minter_program,
            cctp_message_transmitter_program,
            core_bridge_program,
            core_bridge_fee_collector,
            core_bridge_config,
            token_program,
            system_program,
            clock,
            rent,
        } = self.accounts;
        Instruction {
            program_id: *self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(*payer, true),                // 0
                AccountMeta::new(*post_shim_message, false),            // 1
                AccountMeta::new(*core_bridge_emitter_sequence, false), // 2
                AccountMeta::new_readonly(*post_message_shim_event_authority, false), // 3
                AccountMeta::new_readonly(*post_message_shim_program, false), // 4
                AccountMeta::new(*custodian, false),                    // 5
                AccountMeta::new(*fee_recipient_token, false),          // 6
                AccountMeta::new_readonly(*closed_prepared_order_response, false), // 7
                AccountMeta::new(*closed_prepared_order_response_actor, false), // 8
                AccountMeta::new(*closed_prepared_order_response_custody_token, false), // 9
                AccountMeta::new(*auction, false),                      // 10
                AccountMeta::new(*cctp_message, false),                 // 11
                AccountMeta::new(*cctp_mint, false),                    // 12
                AccountMeta::new_readonly(*cctp_token_messenger_minter_sender_authority, false), // 13
                AccountMeta::new(*cctp_message_transmitter_config, false), // 14
                AccountMeta::new_readonly(*cctp_token_messenger, false),   // 15
                AccountMeta::new_readonly(*cctp_remote_token_messenger, false), // 16
                AccountMeta::new(*cctp_token_minter, false),               // 17
                AccountMeta::new(*cctp_local_token, false),                // 18
                AccountMeta::new_readonly(*cctp_token_messenger_minter_event_authority, false), // 19
                AccountMeta::new_readonly(*cctp_token_messenger_minter_program, false), // 20
                AccountMeta::new_readonly(*cctp_message_transmitter_program, false),    // 21
                AccountMeta::new_readonly(*core_bridge_program, false),                 // 22
                AccountMeta::new(*core_bridge_fee_collector, false),                    // 23
                AccountMeta::new(*core_bridge_config, false),                           // 24
                AccountMeta::new_readonly(*token_program, false),                       // 25
                AccountMeta::new_readonly(*system_program, false),                      // 26
                AccountMeta::new_readonly(*clock, false),                               // 27
                AccountMeta::new_readonly(*rent, false),                                // 28
            ],
            data: FallbackMatchingEngineInstruction::SettleAuctionNoneCctpShim(&self.data).to_vec(),
        }
    }
}

pub fn process(accounts: &[AccountInfo], data: &SettleAuctionNoneCctpShimData) -> Result<()> {
    require_min_account_infos_len(accounts, 29)?;
    let payer = &accounts[0];
    let post_shim_infos = &accounts[1..=4];

    let custodian_info = &accounts[5];
    let checked_custodian = super::helpers::try_custodian_account(custodian_info, false)?;

    let fee_recipient_token_info = &accounts[6];
    // Check that the fee recipient token is the custodian's fee recipient token
    require_keys_eq!(
        *fee_recipient_token_info.key,
        checked_custodian.fee_recipient_token,
        MatchingEngineError::InvalidFeeRecipientToken
    );

    let closed_prepared_order_response_infos = &accounts[7..=9];

    let closed_prepared_order_response_info = &closed_prepared_order_response_infos[0];
    let mut prepared_order_response = Box::new(PreparedOrderResponse::try_deserialize(
        &mut &closed_prepared_order_response_info.data.borrow_mut()[..],
    )?);
    let prepared_order_response_pda = Pubkey::create_program_address(
        &[
            PreparedOrderResponse::SEED_PREFIX,
            prepared_order_response.seeds.fast_vaa_hash.as_ref(),
            &[prepared_order_response.seeds.bump],
        ],
        &ID,
    )
    .map_err(|_| MatchingEngineError::InvalidPda)?;
    require_keys_eq!(
        prepared_order_response_pda,
        *closed_prepared_order_response_info.key,
        MatchingEngineError::InvalidPda
    );

    let closed_prepared_order_response_actor_info = &closed_prepared_order_response_infos[1];
    // Check prepared by is the same as the prepared by in the accounts
    require_keys_eq!(
        prepared_order_response.prepared_by,
        *closed_prepared_order_response_actor_info.key
    );

    let closed_prepared_order_response_custody_token_info =
        &closed_prepared_order_response_infos[2];

    // Check seeds of prepared custody token are valid
    let prepared_custody_token = {
        // First do checks on the prepared custody token address
        let (prepared_custody_token_pda, _) = Pubkey::find_program_address(
            &[
                crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
                closed_prepared_order_response_info.key.as_ref(),
            ],
            &ID,
        );
        require_keys_eq!(
            prepared_custody_token_pda,
            *closed_prepared_order_response_custody_token_info.key,
            MatchingEngineError::InvalidPda
        );
        Box::new(TokenAccount::try_deserialize(
            &mut &closed_prepared_order_response_custody_token_info
                .data
                .borrow_mut()[..],
        )?)
    };

    let cctp_infos = &accounts[11..=21];

    let _core_bridge_infos = &accounts[22..=24];
    let token_program = &accounts[25];
    let system_program = &accounts[26];
    let _required_sysvars = &accounts[27..=28];

    // Check seeds of prepared order response are valid

    // Begin of initialisation of auction account
    // ------------------------------------------------------------------------------------------------
    let auction_info = &accounts[10]; // Will be created here
                                      // Check seeds of auction are valid
    let auction_seeds = [
        Auction::SEED_PREFIX,
        prepared_order_response.seeds.fast_vaa_hash.as_ref(),
        &[data.auction_bump],
    ];
    let auction_pda = Pubkey::create_program_address(&auction_seeds, &ID)
        .map_err(|_| MatchingEngineError::InvalidPda)?;
    require_keys_eq!(
        auction_pda,
        *auction_info.key,
        MatchingEngineError::InvalidPda
    );

    let auction_space = 8 + Auction::INIT_SPACE_NO_AUCTION;

    let auction_signer_seeds = &[&auction_seeds[..]];
    create_account_reliably(
        payer.key,
        auction_info.key,
        auction_info.lamports(),
        auction_space,
        accounts,
        &ID,
        auction_signer_seeds,
    )?;
    let mut auction = Box::new(prepared_order_response.new_auction_placeholder(data.auction_bump));

    let SettledNone {
        user_amount,
        fill,
        auction_settled_event: _,
    } = {
        let fee_recipient_token = Box::new(TokenAccount::try_deserialize(
            &mut &fee_recipient_token_info.data.borrow_mut()[..],
        )?);
        settle_none_and_prepare_fill(
            SettleNoneAndPrepareFill {
                prepared_order_response_key: closed_prepared_order_response_info.key,
                prepared_order_response: &mut prepared_order_response,
                prepared_custody_token_key: closed_prepared_order_response_custody_token_info.key,
                prepared_custody_token: &prepared_custody_token,
                auction: &mut auction,
                fee_recipient_token_key: fee_recipient_token_info.key,
                fee_recipient_token: &fee_recipient_token,
                custodian_key: custodian_info.key,
            },
            accounts,
        )?
    };

    let new_auction: &mut [u8] = &mut accounts[10].try_borrow_mut_data()?;
    let mut new_auction_cursor = std::io::Cursor::new(new_auction);
    auction.try_serialize(&mut new_auction_cursor)?;

    // ------------------------------------------------------------------------------------------------
    // End of initialisation of auction account

    // Begin of burning and posting the message
    // ------------------------------------------------------------------------------------------------
    let cctp_message = &cctp_infos[0];

    // Check cctp message is writable
    if !cctp_message.is_writable {
        msg!("Cctp message is not writable");
        return Err(MatchingEngineError::AccountNotWritable.into())
            .map_err(|e: Error| e.with_account_name("cctp_message"));
    }
    // Check cctp message seeds are valid
    let cctp_message_seeds = [
        common::CCTP_MESSAGE_SEED_PREFIX,
        auction_info.key.as_ref(),
        &[data.cctp_message_bump],
    ];

    let cctp_message_pda = Pubkey::create_program_address(&cctp_message_seeds, &ID)
        .map_err(|_| MatchingEngineError::InvalidPda)?;
    require_keys_eq!(
        cctp_message_pda,
        *cctp_message.key,
        MatchingEngineError::InvalidPda
    );

    let cctp_mint = &cctp_infos[1];
    let cctp_token_messenger_minter_sender_authority = &cctp_infos[2];
    let cctp_message_transmitter_config = &cctp_infos[3];
    let cctp_token_messenger = &cctp_infos[4];
    let cctp_remote_token_messenger = &cctp_infos[5];
    let cctp_token_minter = &cctp_infos[6];
    let cctp_local_token = &cctp_infos[7];
    let cctp_token_messenger_minter_event_authority = &cctp_infos[8];
    let cctp_token_messenger_minter_program = &cctp_infos[9];
    let cctp_message_transmitter_program = &cctp_infos[10];

    let post_shim_message = &post_shim_infos[0];
    let core_bridge_emitter_sequence = &post_shim_infos[1];
    let _post_message_shim_event_authority = &post_shim_infos[2];
    let _post_message_shim_program = &post_shim_infos[3];

    let post_message_accounts = PostMessageAccounts {
        emitter: custodian_info.key,
        payer: payer.key,
        message: post_shim_message.key,
        sequence: core_bridge_emitter_sequence.key,
    };

    // TODO: Do we need this check? The prepared order response will only be created with a correct endpoint?
    let to_router_endpoint = prepared_order_response.to_endpoint;
    let destination_cctp_domain = match to_router_endpoint.protocol {
        MessageProtocol::Cctp { domain } => domain,
        _ => return Err(MatchingEngineError::InvalidCctpEndpoint.into()),
    };
    burn_and_post(
        CpiContext::new_with_signer(
            cctp_token_messenger_minter_program.to_account_info(),
            common::wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: custodian_info.to_account_info(),
                payer: payer.to_account_info(),
                token_messenger_minter_sender_authority:
                    cctp_token_messenger_minter_sender_authority.to_account_info(),
                burn_token: closed_prepared_order_response_custody_token_info.to_account_info(),
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
                    auction_info.key.as_ref(),
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
        closed_prepared_order_response_custody_token_info.key,
        closed_prepared_order_response_actor_info.key,
        custodian_info.key,
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
