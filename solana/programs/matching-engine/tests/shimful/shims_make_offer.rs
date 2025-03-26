use crate::testing_engine::config::ExpectedError;
use crate::testing_engine::state::InitialOfferPlacedState;

use super::super::utils;
use super::super::utils::setup::Solver;
use super::super::utils::setup::TestingContext;
use matching_engine::fallback::place_initial_offer::{
    PlaceInitialOfferCctpShim as PlaceInitialOfferCctpShimFallback,
    PlaceInitialOfferCctpShimAccounts as PlaceInitialOfferCctpShimFallbackAccounts,
    PlaceInitialOfferCctpShimData as PlaceInitialOfferCctpShimFallbackData,
};
use matching_engine::state::Auction;

use super::fast_market_order_shim::create_fast_market_order_state_from_vaa_data;
use solana_sdk::{pubkey::Pubkey, signature::Keypair, signer::Signer, transaction::Transaction};
use std::rc::Rc;

/// Places an initial offer using the fallback program. The vaa is constructed from a passed in PostedVaaData struct. The nonce is forced to 0.
pub async fn place_initial_offer_fallback(
    testing_context: &TestingContext,
    payer_signer: &Rc<Keypair>,
    vaa_data: &utils::vaa::PostedVaaData,
    solver: Solver,
    fast_market_order_account: &Pubkey,
    auction_accounts: &utils::auction::AuctionAccounts,
    offer_price: u64,
    expected_error: Option<&ExpectedError>,
) -> Option<InitialOfferPlacedState> {
    let program_id = testing_context.get_matching_engine_program_id();
    let test_ctx = &testing_context.test_context;
    let (fast_market_order, vaa_data) =
        create_fast_market_order_state_from_vaa_data(vaa_data, solver.pubkey());

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

    solver
        .approve_usdc(test_ctx, &transfer_authority, 420_000__000_000)
        .await;

    let solver_usdc_balance = solver.get_balance(test_ctx).await;
    println!("Solver USDC balance: {:?}", solver_usdc_balance);

    let place_initial_offer_ix_data = PlaceInitialOfferCctpShimFallbackData::new(
        offer_price,
        vaa_data.sequence,
        vaa_data.vaa_time,
        vaa_data.consistency_level,
    );

    let place_initial_offer_ix_accounts = PlaceInitialOfferCctpShimFallbackAccounts {
        signer: &payer_signer.pubkey(),
        transfer_authority: &transfer_authority,
        custodian: &auction_accounts.custodian,
        auction_config: &auction_accounts.auction_config,
        from_endpoint: &auction_accounts.from_router_endpoint,
        to_endpoint: &auction_accounts.to_router_endpoint,
        fast_market_order: fast_market_order_account,
        auction: &auction_address,
        offer_token: &auction_accounts.offer_token,
        auction_custody_token: &auction_custody_token_address,
        usdc: &auction_accounts.usdc_mint,
        system_program: &solana_program::system_program::ID,
        token_program: &anchor_spl::token::spl_token::ID,
    };
    let place_initial_offer_ix = PlaceInitialOfferCctpShimFallback {
        program_id: &program_id,
        accounts: place_initial_offer_ix_accounts,
        data: place_initial_offer_ix_data,
    }
    .instruction();

    let recent_blockhash = test_ctx.borrow().last_blockhash;

    let transaction = Transaction::new_signed_with_payer(
        &[place_initial_offer_ix],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        recent_blockhash,
    );

    testing_context
        .execute_and_verify_transaction(transaction, expected_error)
        .await;
    if expected_error.is_none() {
        let new_active_auction_state = utils::auction::ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address: auction_accounts.auction_config,
            initial_offer: utils::auction::AuctionOffer {
                participant: payer_signer.pubkey(),
                offer_token: auction_accounts.offer_token,
                offer_price,
            },
            best_offer: utils::auction::AuctionOffer {
                participant: payer_signer.pubkey(),
                offer_token: auction_accounts.offer_token,
                offer_price,
            },
        };
        let new_auction_state = utils::auction::AuctionState::Active(new_active_auction_state);
        Some(InitialOfferPlacedState {
            auction_state: new_auction_state,
        })
    } else {
        None
    }
}
