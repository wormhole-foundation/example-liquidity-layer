use super::super::utils;
use anchor_lang::prelude::*;
use anchor_lang::InstructionData;

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
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use utils::auction::{ActiveAuctionState, AuctionAccounts, AuctionOffer, AuctionState};
use utils::setup::{Solver, TestingContext};
use utils::vaa::TestVaa;

pub async fn place_initial_offer_shimless(
    testing_context: &mut TestingContext,
    accounts: &AuctionAccounts,
    fast_market_order: TestVaa,
    program_id: Pubkey,
    expected_to_pass: bool,
) {
    let test_ctx = &testing_context.test_context;
    let owner_keypair = testing_context.testing_actors.owner.keypair();
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
    let initial_offer_ix = PlaceInitialOfferCctpIx {
        offer_price: 1__000_000,
    };

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
        let usdc_account_info = test_ctx
            .borrow_mut()
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
                .approve_usdc(test_ctx, &transfer_authority, 420_000__000_000)
                .await;
        } else {
            let delegate = token_account_info.delegate.unwrap();
            if delegate != transfer_authority {
                accounts
                    .solver
                    .approve_usdc(test_ctx, &transfer_authority, 420_000__000_000)
                    .await;
            }
        }
    }

    let custodian = CheckedCustodian {
        custodian: accounts.custodian,
    };
    let initial_offer_accounts = PlaceInitialOfferCctpAccounts {
        payer: owner_keypair.pubkey(),
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
        program_id: program_id,
        accounts: account_metas,
        data: initial_offer_ix.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[initial_offer_ix_anchor],
        Some(&owner_keypair.pubkey()),
        &[&owner_keypair],
        test_ctx.borrow().last_blockhash,
    );

    let tx_result = test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(tx)
        .await;
    assert_eq!(tx_result.is_ok(), expected_to_pass);
    if tx_result.is_ok() {
        testing_context.testing_state.auction_state = AuctionState::Active(ActiveAuctionState {
            auction_address,
            auction_custody_token_address,
            initial_offer: AuctionOffer {
                offer_token: accounts.offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
            best_offer: AuctionOffer {
                offer_token: accounts.offer_token,
                offer_price: initial_offer_ix.offer_price,
            },
        });
    };
}

pub async fn improve_offer(
    testing_context: &mut TestingContext,
    program_id: Pubkey,
    solver: Solver,
    auction_config: Pubkey,
) {
    let test_ctx = &testing_context.test_context;
    let owner_keypair = testing_context.testing_actors.owner.keypair();
    let auction_state = &mut testing_context
        .testing_state
        .auction_state
        .get_active_auction_mut()
        .unwrap();
    let auction_address = auction_state.auction_address;
    let auction_custody_token_address = auction_state.auction_custody_token_address;

    // Decrease the offer by 0.5 usdc
    let improve_offer_ix = ImproveOfferIx {
        offer_price: auction_state.best_offer.offer_price - 500_000,
    };

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
        .approve_usdc(test_ctx, &transfer_authority, 420_000__000_000)
        .await;
    let offer_token = solver.token_account_address().unwrap();

    let active_auction = ActiveAuction {
        auction: auction_address,
        custody_token: auction_custody_token_address,
        config: auction_config,
        best_offer_token: auction_state.best_offer.offer_token,
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
        if meta.pubkey == auction_state.best_offer.offer_token {
            meta.is_writable = true;
        }
    }

    // TODO: Figure out better name for this
    let improve_offer_ix_anchor = Instruction {
        program_id: program_id,
        accounts: account_metas,
        data: improve_offer_ix.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[improve_offer_ix_anchor],
        Some(&owner_keypair.pubkey()),
        &[&owner_keypair],
        test_ctx.borrow().last_blockhash,
    );

    test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(tx)
        .await
        .expect("Failed to improve offer");

    auction_state.best_offer = AuctionOffer {
        offer_token,
        offer_price: improve_offer_ix.offer_price,
    };
}
