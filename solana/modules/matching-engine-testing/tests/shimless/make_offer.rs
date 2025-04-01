use std::rc::Rc;

use crate::testing_engine::config::ExpectedError;

use super::super::utils;
use anchor_lang::prelude::*;
use anchor_lang::InstructionData;

use crate::testing_engine::setup::{Solver, TestingContext};
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
use solana_sdk::signature::Keypair;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use utils::auction::{ActiveAuctionState, AuctionAccounts, AuctionOffer, AuctionState};
use utils::vaa::TestVaa;

pub async fn place_initial_offer_shimless(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    accounts: &AuctionAccounts,
    fast_market_order: &TestVaa,
    offer_price: u64,
    payer_signer: &Rc<Keypair>,
    expected_error: Option<&ExpectedError>,
) -> AuctionState {
    let program_id = testing_context.get_matching_engine_program_id();
    let auction_address = Pubkey::find_program_address(
        &[Auction::SEED_PREFIX, &fast_market_order.vaa_data.digest()],
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
    let initial_offer_ix = PlaceInitialOfferCctpIx { offer_price };

    let fast_order_path = FastOrderPath {
        fast_vaa: LiquidityLayerVaa {
            vaa: fast_market_order.vaa_pubkey,
        },
        path: LiveRouterPath {
            from_endpoint: LiveRouterEndpoint {
                endpoint: accounts.from_router_endpoint,
            },
            to_endpoint: LiveRouterEndpoint {
                endpoint: accounts.to_router_endpoint,
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
        let usdc_account = accounts.solver.token_account_address().unwrap();
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
            accounts
                .solver
                .approve_usdc(test_context, &transfer_authority, 420_000__000_000)
                .await;
        } else {
            let delegate = token_account_info.delegate.unwrap();
            if delegate != transfer_authority {
                accounts
                    .solver
                    .approve_usdc(test_context, &transfer_authority, 420_000__000_000)
                    .await;
            }
        }
    }

    let custodian = CheckedCustodian {
        custodian: accounts.custodian,
    };
    let initial_offer_accounts = PlaceInitialOfferCctpAccounts {
        payer: payer_signer.pubkey(),
        transfer_authority,
        custodian,
        auction_config: accounts.auction_config,
        fast_order_path,
        auction: auction_address,
        offer_token: accounts.offer_token,
        auction_custody_token: auction_custody_token_address,
        usdc: Usdc {
            mint: accounts.usdc_mint,
        },
        system_program: anchor_lang::system_program::ID,
        token_program: anchor_spl::token::ID,
        program: program_id,
        event_authority,
    };

    let mut account_metas = initial_offer_accounts.to_account_metas(None);
    for meta in account_metas.iter_mut() {
        if meta.pubkey == accounts.offer_token {
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
        &[payer_signer],
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
        AuctionState::Active(Box::new(ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address: accounts.auction_config,
            initial_offer: AuctionOffer {
                participant: payer_signer.pubkey(),
                offer_token: accounts.offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
            best_offer: AuctionOffer {
                participant: payer_signer.pubkey(),
                offer_token: accounts.offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
        }))
    } else {
        AuctionState::Inactive
    }
}

pub async fn improve_offer(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    solver: Solver,
    offer_price: u64,
    payer_signer: &Rc<Keypair>,
    initial_auction_state: &AuctionState,
    expected_error: Option<&ExpectedError>,
) -> Option<AuctionState> {
    let program_id = testing_context.get_matching_engine_program_id();
    let active_auction_state = initial_auction_state.get_active_auction().unwrap();
    let auction_config = active_auction_state.auction_config_address;
    let auction_address = active_auction_state.auction_address;
    let auction_custody_token_address = active_auction_state.auction_custody_token_address;

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
    solver
        .approve_usdc(test_context, &transfer_authority, 420_000__000_000)
        .await;
    let offer_token = solver.token_account_address().unwrap();

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
        &[payer_signer],
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
        let initial_offer = &initial_auction_state
            .get_active_auction()
            .unwrap()
            .initial_offer;
        Some(AuctionState::Active(Box::new(ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            auction_config_address: auction_config,
            initial_offer: initial_offer.clone(),
            best_offer: AuctionOffer {
                participant: payer_signer.pubkey(),
                offer_token,
                offer_price,
            },
        })))
    } else {
        None
    }
}
