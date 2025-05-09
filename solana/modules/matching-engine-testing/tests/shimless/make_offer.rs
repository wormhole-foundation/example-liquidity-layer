use crate::testing_engine::config::ImproveOfferInstructionConfig;
use crate::testing_engine::config::InstructionConfig;
use crate::testing_engine::config::PlaceInitialOfferInstructionConfig;
use crate::testing_engine::state::TestingEngineState;
use crate::utils::auction::AuctionAccounts;

use super::super::utils;
use anchor_lang::prelude::*;
use anchor_lang::InstructionData;

use crate::testing_engine::setup::TestingContext;
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use matching_engine::accounts::ImproveOffer as ImproveOfferAccounts;
use matching_engine::accounts::{
    ActiveAuction, CheckedCustodian, FastOrderPath, LiquidityLayerVaa, LiveRouterEndpoint,
    LiveRouterPath, PlaceInitialOfferCctp as PlaceInitialOfferCctpAccounts, Usdc,
};
use matching_engine::instruction::{
    ImproveOffer as ImproveOfferIx, PlaceInitialOfferCctp as PlaceInitialOfferCctpIx,
};
use matching_engine::state::Auction;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use utils::auction::{ActiveAuctionState, AuctionOffer, AuctionState};

/// Place an initial offer (shimless)
///
/// Place an initial offer by providing a price.
///
/// # Arguments
///
/// * `testing_context`: The testing context of the testing engine
/// * `test_context`: Mutable reference to the program test context
/// * `current_state`: The current state of the testing engine
/// * `config`: The configuration for the place initial offer instruction
///
/// # Returns
///
/// The new state of the testing engine (if successful), otherwise the old state.
pub async fn place_initial_offer_shimless(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &PlaceInitialOfferInstructionConfig,
) -> TestingEngineState {
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let offer_actor = config.actor.get_actor(&testing_context.testing_actors);
    let offer_token = offer_actor
        .token_account_address(&config.spl_token_enum)
        .unwrap();
    let expected_error = config.expected_error();
    let fast_vaa = &current_state
        .base()
        .vaas
        .get(config.test_vaa_pair_index)
        .expect("Failed to get vaa pair")
        .fast_transfer_vaa;
    let auction_config_address = current_state
        .initialized()
        .expect("Testing state is not initialized")
        .auction_config_address;
    let custodian_address = current_state
        .initialized()
        .expect("Testing state is not initialized")
        .custodian_address;
    let program_id = testing_context.get_matching_engine_program_id();
    let auction_address = Pubkey::find_program_address(
        &[Auction::SEED_PREFIX, &fast_vaa.vaa_data.digest()],
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
    let initial_offer_ix = PlaceInitialOfferCctpIx {
        offer_price: config.offer_price,
    };
    let (from_router_endpoint, to_router_endpoint) = match &config.custom_accounts {
        Some(custom_accounts) => {
            let from_router_endpoint = match custom_accounts.from_router_endpoint {
                Some(from_router_endpoint) => from_router_endpoint,
                None => {
                    current_state
                        .router_endpoints()
                        .expect("Router endpoints are not initialized")
                        .endpoints
                        .get_from_and_to_endpoint_addresses(current_state.base().transfer_direction)
                        .0
                }
            };
            let to_router_endpoint = match custom_accounts.to_router_endpoint {
                Some(to_router_endpoint) => to_router_endpoint,
                None => {
                    current_state
                        .router_endpoints()
                        .expect("Router endpoints are not initialized")
                        .endpoints
                        .get_from_and_to_endpoint_addresses(current_state.base().transfer_direction)
                        .1
                }
            };
            (from_router_endpoint, to_router_endpoint)
        }
        None => current_state
            .router_endpoints()
            .expect("Router endpoints are not initialized")
            .endpoints
            .get_from_and_to_endpoint_addresses(current_state.base().transfer_direction),
    };
    let fast_order_path = FastOrderPath {
        fast_vaa: LiquidityLayerVaa {
            vaa: fast_vaa.vaa_pubkey,
        },
        path: LiveRouterPath {
            from_endpoint: LiveRouterEndpoint {
                endpoint: from_router_endpoint,
            },
            to_endpoint: LiveRouterEndpoint {
                endpoint: to_router_endpoint,
            },
        },
    };

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], &program_id).0;
    let transfer_authority = Pubkey::find_program_address(
        &[
            TRANSFER_AUTHORITY_SEED_PREFIX,
            &auction_address.to_bytes(),
            &initial_offer_ix.offer_price.to_be_bytes(),
        ],
        &program_id,
    )
    .0;
    {
        // Check if solver has already approved usdc
        let usdc_account = offer_actor
            .token_account_address(&config.spl_token_enum)
            .unwrap();
        let usdc_account_info = test_context
            .banks_client
            .get_account(usdc_account)
            .await
            .unwrap()
            .unwrap();
        let token_account_info = anchor_spl::token::TokenAccount::try_deserialize(
            &mut usdc_account_info.data.as_slice(),
        )
        .expect("Failed to deserialize usdc account");
        if token_account_info.delegate.is_none() {
            offer_actor
                .approve_spl_token(
                    test_context,
                    &transfer_authority,
                    420_000__000_000,
                    &config.spl_token_enum,
                )
                .await;
        } else {
            let delegate = token_account_info.delegate.unwrap();
            if delegate != transfer_authority {
                offer_actor
                    .approve_spl_token(
                        test_context,
                        &transfer_authority,
                        420_000__000_000,
                        &config.spl_token_enum,
                    )
                    .await;
            }
        }
    }

    let custodian = CheckedCustodian {
        custodian: custodian_address,
    };
    let usdc_mint_address = match &config.custom_accounts {
        Some(custom_accounts) => match custom_accounts.mint_address {
            Some(usdc_mint_address) => usdc_mint_address,
            None => testing_context.get_usdc_mint_address(),
        },
        None => testing_context.get_usdc_mint_address(),
    };
    let initial_offer_accounts = PlaceInitialOfferCctpAccounts {
        payer: payer_signer.pubkey(),
        transfer_authority,
        custodian,
        auction_config: auction_config_address,
        fast_order_path,
        auction: auction_address,
        offer_token: offer_actor
            .token_account_address(&config.spl_token_enum)
            .unwrap(),
        auction_custody_token: auction_custody_token_address,
        usdc: Usdc {
            mint: usdc_mint_address,
        },
        system_program: anchor_lang::system_program::ID,
        token_program: anchor_spl::token::ID,
        program: program_id,
        event_authority,
    };

    let mut account_metas = initial_offer_accounts.to_account_metas(None);
    for meta in account_metas.iter_mut() {
        if meta.pubkey == offer_token {
            meta.is_writable = true;
        }
    }

    let initial_offer_ix_anchor = Instruction {
        program_id,
        accounts: account_metas,
        data: initial_offer_ix.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[initial_offer_ix_anchor],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .unwrap(),
    );

    testing_context
        .execute_and_verify_transaction(test_context, tx, expected_error)
        .await;

    // If the transaction failed and we expected it to pass, we would not get here
    if expected_error.is_none() {
        let auction_state = AuctionState::Active(Box::new(ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address,
            initial_offer: AuctionOffer {
                actor: config.actor,
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
            best_offer: AuctionOffer {
                actor: config.actor,
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
            spl_token_enum: config.spl_token_enum.clone(),
        }));

        let auction_accounts = AuctionAccounts::new(
            Some(fast_vaa.get_vaa_pubkey()),
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
        );

        auction_state
            .get_active_auction()
            .unwrap()
            .verify_auction(&testing_context, test_context)
            .await
            .expect("Could not verify auction state");
        return TestingEngineState::InitialOfferPlaced {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().unwrap().clone(),
            fast_market_order: current_state.fast_market_order().cloned(),
            auction_state,
            auction_accounts,
            order_prepared: current_state.order_prepared().cloned(),
        };
    }
    current_state.clone()
}

/// Improve an offer (shimless)
///
/// Improve an offer by providing a new price.
///
/// # Arguments
///
/// * `testing_context`: The testing context of the testing engine
/// * `test_context`: Mutable reference to the program test context
/// * `current_state`: The current state of the testing engine
/// * `config`: The configuration for the improve offer instruction
///
/// # Returns
///
/// The new state of the testing engine
pub async fn improve_offer(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    current_state: &TestingEngineState,
    config: &ImproveOfferInstructionConfig,
) -> TestingEngineState {
    let initial_auction_state = current_state.auction_state();
    let actor = config.actor.get_actor(&testing_context.testing_actors);
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    let program_id = testing_context.get_matching_engine_program_id();
    let active_auction_state = initial_auction_state.get_active_auction().unwrap();
    let auction_config = active_auction_state.auction_config_address;
    let auction_address = active_auction_state.auction_address;
    let auction_custody_token_address = active_auction_state.auction_custody_token_address;
    let offer_price = config.offer_price;
    let improve_offer_ix = ImproveOfferIx { offer_price };

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], &program_id).0;
    let transfer_authority = Pubkey::find_program_address(
        &[
            TRANSFER_AUTHORITY_SEED_PREFIX,
            &auction_address.to_bytes(),
            &improve_offer_ix.offer_price.to_be_bytes(),
        ],
        &program_id,
    )
    .0;
    let spl_token_enum = &active_auction_state.spl_token_enum;
    actor
        .approve_spl_token(
            test_context,
            &transfer_authority,
            420_000__000_000,
            spl_token_enum,
        )
        .await;
    let offer_token = actor.token_account_address(spl_token_enum).unwrap();

    let active_auction = ActiveAuction {
        auction: auction_address,
        custody_token: auction_custody_token_address,
        config: auction_config,
        best_offer_token: active_auction_state.best_offer.offer_token,
    };
    let improve_offer_accounts = ImproveOfferAccounts {
        transfer_authority,
        active_auction,
        offer_token,
        token_program: anchor_spl::token::ID,
        event_authority,
        program: program_id,
    };

    let mut account_metas = improve_offer_accounts.to_account_metas(None);
    for meta in account_metas.iter_mut() {
        if meta.pubkey == active_auction_state.best_offer.offer_token {
            meta.is_writable = true;
        }
    }

    // TODO: Figure out better name for this
    let improve_offer_ix_anchor = Instruction {
        program_id,
        accounts: account_metas,
        data: improve_offer_ix.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[improve_offer_ix_anchor],
        Some(&payer_signer.pubkey()),
        &[&payer_signer],
        testing_context
            .get_new_latest_blockhash(test_context)
            .await
            .unwrap(),
    );

    let expected_error = config.expected_error();
    testing_context
        .execute_and_verify_transaction(test_context, tx, expected_error)
        .await;

    // If the transaction failed and we expected it to pass, we would not get here
    if expected_error.is_none() {
        let initial_offer = &initial_auction_state
            .get_active_auction()
            .unwrap()
            .initial_offer;
        let new_auction_state = AuctionState::Active(Box::new(ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address: auction_config,
            initial_offer: initial_offer.clone(),
            best_offer: AuctionOffer {
                actor: config.actor,
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price,
            },
            spl_token_enum: spl_token_enum.clone(),
        }));

        new_auction_state
            .get_active_auction()
            .unwrap()
            .verify_auction(&testing_context, test_context)
            .await
            .expect("Could not verify auction state");
        return TestingEngineState::OfferImproved {
            base: current_state.base().clone(),
            initialized: current_state.initialized().unwrap().clone(),
            router_endpoints: current_state.router_endpoints().unwrap().clone(),
            fast_market_order: current_state.fast_market_order().cloned(),
            auction_state: new_auction_state,
            auction_accounts: current_state.auction_accounts().cloned(),
            order_prepared: current_state.order_prepared().cloned(),
        };
    }
    current_state.clone()
}
