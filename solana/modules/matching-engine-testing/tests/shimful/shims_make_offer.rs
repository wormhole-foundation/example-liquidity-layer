use crate::testing_engine::config::{ExpectedError, PlaceInitialOfferInstructionConfig};
use crate::testing_engine::state::{InitialOfferPlacedState, TestingEngineState};
use crate::utils::auction::AuctionAccounts;

use super::super::utils;
use crate::testing_engine::setup::TestingContext;
use matching_engine::fallback::place_initial_offer::{
    PlaceInitialOfferCctpShim as PlaceInitialOfferCctpShimFallback,
    PlaceInitialOfferCctpShimAccounts as PlaceInitialOfferCctpShimFallbackAccounts,
    PlaceInitialOfferCctpShimData as PlaceInitialOfferCctpShimFallbackData,
};
use matching_engine::state::Auction;
use solana_program_test::ProgramTestContext;

use super::fast_market_order_shim::create_fast_market_order_state_from_vaa_data;
use solana_sdk::{pubkey::Pubkey, signer::Signer, transaction::Transaction};

/// Places an initial offer using the fallback program. The vaa is constructed from a passed in PostedVaaData struct. The nonce is forced to 0.
///
/// # Arguments
///
/// * `testing_context` - The testing context
/// * `payer_signer` - The payer signer
/// * `vaa_data` - The vaa data (not posted)
/// * `solver` - The solver actor that will place the initial offer
/// * `fast_market_order_account` - The fast market order account pubkey created by the create fast market order shim instruction
/// * `auction_accounts` - The auction accounts (see utils/auction.rs)
/// * `offer_price` - The offer price in the units of the offer token
/// * `expected_error` - The expected error (None if no error is expected)
///
/// # Returns
///
/// * `Option<InitialOfferPlacedState>` - An auction state with the initial offer placed. None if an error is expected.
///
/// # Asserts
///
/// * The expected error is reached
/// * If successful, the solver's USDC balance should decrease by the offer price
pub async fn place_initial_offer_fallback(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &PlaceInitialOfferInstructionConfig,
    expected_error: Option<&ExpectedError>,
) -> Option<InitialOfferPlacedState> {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let close_account_refund_recipient = current_state
        .fast_market_order()
        .unwrap()
        .close_account_refund_recipient;
    let fast_market_order_address = match &config.fast_market_order_address {
        Some(fast_market_order_address) => *fast_market_order_address,
        None => {
            current_state
                .fast_market_order()
                .expect("Fast market order is not created")
                .fast_market_order_address
        }
    };
    let auction_config_address = current_state.auction_config_address().unwrap();
    let custodian_address = current_state.custodian_address().unwrap();
    let program_id = testing_context.get_matching_engine_program_id();
    let fast_transfer_vaa = &current_state
        .base()
        .vaas
        .get(config.test_vaa_pair_index)
        .expect("Failed to get vaa pair")
        .fast_transfer_vaa;
    let vaa_data = fast_transfer_vaa.get_vaa_data();
    let fast_market_order =
        create_fast_market_order_state_from_vaa_data(vaa_data, close_account_refund_recipient);
    let offer_price = config.offer_price;
    let actor_enum = config.actor;
    let offer_actor = config.actor.get_actor(&testing_context.testing_actors);
    let offer_token = match &config.custom_accounts {
        Some(custom_accounts) => match custom_accounts.offer_token_address {
            Some(offer_token_address) => offer_token_address,
            None => offer_actor
                .token_account_address(&config.spl_token_enum)
                .unwrap(),
        },
        None => offer_actor
            .token_account_address(&config.spl_token_enum)
            .unwrap(),
    };
    let auction_address = Pubkey::find_program_address(
        &[Auction::SEED_PREFIX, &fast_market_order.digest()],
        &program_id,
    )
    .0;
    let auction_custody_token_address = Pubkey::find_program_address(
        &[
            matching_engine::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            auction_address.as_ref(),
        ],
        &program_id,
    )
    .0;

    // Approve the transfer authority
    let transfer_authority = Pubkey::find_program_address(
        &[
            common::TRANSFER_AUTHORITY_SEED_PREFIX,
            &auction_address.to_bytes(),
            &offer_price.to_be_bytes(),
        ],
        &program_id,
    )
    .0;

    offer_actor
        .approve_spl_token(
            test_context,
            &transfer_authority,
            420_000__000_000,
            &config.spl_token_enum,
        )
        .await;

    let actor_usdc_balance_before = offer_actor
        .get_token_account_balance(test_context, &config.spl_token_enum)
        .await;

    let place_initial_offer_ix_data = PlaceInitialOfferCctpShimFallbackData { offer_price };

    let (from_router_endpoint, to_router_endpoint) =
        config.get_from_and_to_router_endpoints(current_state);

    let usdc_mint_address = match &config.custom_accounts {
        Some(custom_accounts) => match custom_accounts.mint_address {
            Some(usdc_mint_address) => usdc_mint_address,
            None => testing_context.get_usdc_mint_address(),
        },
        None => testing_context.get_usdc_mint_address(),
    };

    let place_initial_offer_ix_accounts = PlaceInitialOfferCctpShimFallbackAccounts {
        signer: &payer_signer.pubkey(),
        transfer_authority: &transfer_authority,
        custodian: &custodian_address,
        auction_config: &auction_config_address,
        from_endpoint: &from_router_endpoint,
        to_endpoint: &to_router_endpoint,
        fast_market_order: &fast_market_order_address,
        auction: &auction_address,
        offer_token: &offer_token,
        auction_custody_token: &auction_custody_token_address,
        usdc: &usdc_mint_address,
        system_program: &solana_program::system_program::ID,
        token_program: &anchor_spl::token::spl_token::ID,
    };
    let place_initial_offer_ix = PlaceInitialOfferCctpShimFallback {
        program_id: &program_id,
        accounts: place_initial_offer_ix_accounts,
        data: place_initial_offer_ix_data,
    }
    .instruction();

    let recent_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await
        .unwrap();

    let transaction = Transaction::new_signed_with_payer(
        &[place_initial_offer_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );

    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;
    if expected_error.is_none() {
        let actor_usdc_balance_after = offer_actor
            .get_token_account_balance(test_context, &config.spl_token_enum)
            .await;
        assert!(
            actor_usdc_balance_after < actor_usdc_balance_before,
            "Solver USDC balance should have decreased"
        );
        let new_active_auction_state = utils::auction::ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address,
            initial_offer: utils::auction::AuctionOffer {
                actor: actor_enum,
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price,
            },
            best_offer: utils::auction::AuctionOffer {
                actor: actor_enum,
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price,
            },
            spl_token_enum: config.spl_token_enum.clone(),
        };
        let new_auction_state =
            utils::auction::AuctionState::Active(Box::new(new_active_auction_state));
        Some(InitialOfferPlacedState {
            auction_state: new_auction_state,
            auction_accounts: AuctionAccounts::new(
                Some(fast_transfer_vaa.get_vaa_pubkey()),
                offer_actor.clone(),
                current_state.close_account_refund_recipient(),
                auction_config_address,
                &current_state
                    .router_endpoints()
                    .expect("Router endpoints are not created")
                    .endpoints,
                custodian_address,
                config.spl_token_enum.clone(),
                current_state.base().transfer_direction,
            ),
        })
    } else {
        None
    }
}
