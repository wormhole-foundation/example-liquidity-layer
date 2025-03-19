use anchor_lang::prelude::*;

use super::router::TestRouterEndpoints;
use super::setup::{Solver, TestingContext, TransferDirection};
use super::vaa::TestVaa;
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
use matching_engine::state::{Auction, AuctionInfo};
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::Signer;
use solana_sdk::transaction::Transaction;
use std::cell::RefCell;
use std::rc::Rc;

pub struct AuctionAccounts {
    pub fast_vaa: Option<Pubkey>,
    pub offer_token: Pubkey,
    pub solver: Solver,
    pub auction_config: Pubkey,
    pub from_router_endpoint: Pubkey,
    pub to_router_endpoint: Pubkey,
    pub custodian: Pubkey,
    pub usdc_mint: Pubkey,
}

pub enum AuctionState {
    Active(ActiveAuctionState),
    Inactive,
}

impl AuctionState {
    pub fn get_active_auction(&self) -> Option<&ActiveAuctionState> {
        match self {
            AuctionState::Active(auction) => Some(auction),
            AuctionState::Inactive => None,
        }
    }

    pub fn get_active_auction_mut(&mut self) -> Option<&mut ActiveAuctionState> {
        match self {
            AuctionState::Active(auction) => Some(auction),
            AuctionState::Inactive => None,
        }
    }
}
pub struct ActiveAuctionState {
    pub auction_address: Pubkey,
    pub auction_custody_token_address: Pubkey,
    pub best_offer: AuctionOffer,
}

pub struct AuctionOffer {
    pub best_offer_token: Pubkey,
    pub best_offer_price: u64,
}

impl AuctionAccounts {
    pub fn new(
        fast_vaa: Option<Pubkey>,
        solver: Solver,
        auction_config: Pubkey,
        router_endpoints: &TestRouterEndpoints,
        custodian: Pubkey,
        usdc_mint: Pubkey,
        direction: TransferDirection,
    ) -> Self {
        let (from_router_endpoint, to_router_endpoint) = match direction {
            TransferDirection::FromEthereumToArbitrum => (
                router_endpoints.ethereum.endpoint_address,
                router_endpoints.arbitrum.endpoint_address,
            ),
            TransferDirection::FromArbitrumToEthereum => (
                router_endpoints.arbitrum.endpoint_address,
                router_endpoints.ethereum.endpoint_address,
            ),
        };
        Self {
            fast_vaa,
            offer_token: solver.token_account_address().unwrap(),
            solver,
            auction_config,
            from_router_endpoint,
            to_router_endpoint,
            custodian,
            usdc_mint,
        }
    }
}

impl ActiveAuctionState {
    // TODO: Figure this out
    pub async fn verify_initial_offer(&self, testing_context: &Rc<RefCell<ProgramTestContext>>) {
        let auction_account = testing_context
            .borrow_mut()
            .banks_client
            .get_account(self.auction_address)
            .await
            .unwrap()
            .expect("Failed to get auction account");
        let mut data_ref = auction_account.data.as_ref();
        let auction_account_data: Auction =
            AccountDeserialize::try_deserialize(&mut data_ref).unwrap();
        let auction_info = auction_account_data.info.unwrap();
        let expected_auction_info = AuctionInfo {
            config_id: 0,
            custody_token_bump: 254, // TODO: Figure this out
            vaa_sequence: 0,
            source_chain: 23,
            best_offer_token: pubkey!("3f3mimemFUZg6o7UuR7AXzt2B5Nh15beCczRPWg8oWnc"), // TODO: Figure this out, I think its the solver's ata
            initial_offer_token: pubkey!("3f3mimemFUZg6o7UuR7AXzt2B5Nh15beCczRPWg8oWnc"), // TODO: Figure this out, I think its the solver's ata
            start_slot: 1,
            amount_in: 69000000,
            security_deposit: 10545000,
            offer_price: 1__000_000,
            redeemer_message_len: 0,
            destination_asset_info: None,
        };
        assert_eq!(auction_info.config_id, expected_auction_info.config_id);
        assert_eq!(
            auction_info.vaa_sequence,
            expected_auction_info.vaa_sequence
        );
        assert_eq!(
            auction_info.source_chain,
            expected_auction_info.source_chain
        );
        assert_eq!(auction_info.start_slot, expected_auction_info.start_slot);
        assert_eq!(auction_info.amount_in, expected_auction_info.amount_in);
        assert_eq!(
            auction_info.security_deposit,
            expected_auction_info.security_deposit
        );
        assert_eq!(auction_info.offer_price, expected_auction_info.offer_price);
        assert_eq!(
            auction_info.redeemer_message_len,
            expected_auction_info.redeemer_message_len
        );
    }
}

pub async fn place_initial_offer(
    testing_context: &mut TestingContext,
    accounts: AuctionAccounts,
    fast_market_order: TestVaa,
    program_id: Pubkey,
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
    accounts
        .solver
        .approve_usdc(test_ctx, &transfer_authority, 420_000__000_000)
        .await;
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

    test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(tx)
        .await
        .expect("Failed to place initial offer");

    testing_context.testing_state.auction_state = AuctionState::Active(ActiveAuctionState {
        auction_address,
        auction_custody_token_address,
        best_offer: AuctionOffer {
            best_offer_token: accounts.offer_token,
            best_offer_price: initial_offer_ix.offer_price,
        },
    });
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
        offer_price: auction_state.best_offer.best_offer_price - 500_000,
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
        best_offer_token: auction_state.best_offer.best_offer_token,
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
        if meta.pubkey == auction_state.best_offer.best_offer_token {
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
        best_offer_token: offer_token,
        best_offer_price: improve_offer_ix.offer_price,
    };
}
