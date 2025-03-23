use anchor_lang::prelude::*;

use super::super::shimless;
use super::router::TestRouterEndpoints;
use super::setup::{Solver, TransferDirection};
use matching_engine::state::{Auction, AuctionInfo};
use solana_program_test::ProgramTestContext;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone)]
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
#[derive(Clone)]
pub struct ActiveAuctionState {
    pub auction_address: Pubkey,
    pub auction_custody_token_address: Pubkey,
    pub auction_config_address: Pubkey,
    pub initial_offer: AuctionOffer,
    pub best_offer: AuctionOffer,
}

#[derive(Clone)]
pub struct AuctionOffer {
    pub offer_token: Pubkey,
    pub offer_price: u64,
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

    pub async fn create_auction_accounts(
        testing_context: &mut super::setup::TestingContext,
        initialize_fixture: &shimless::initialize::InitializeFixture,
        transfer_direction: TransferDirection,
        fast_vaa_pubkey: Option<Pubkey>,
    ) -> Self {
        let usdc_mint_address = testing_context.get_usdc_mint_address();
        let auction_config_address = initialize_fixture.get_auction_config_address();
        let router_endpoints = super::router::create_all_router_endpoints_test(
            &testing_context,
            testing_context.testing_actors.owner.pubkey(),
            initialize_fixture.get_custodian_address(),
            testing_context.testing_actors.owner.keypair(),
        )
        .await;

        let solver = testing_context.testing_actors.solvers[0].clone();
        Self::new(
            fast_vaa_pubkey,                            // Fast VAA pubkey
            solver.clone(),                             // Solver
            auction_config_address.clone(),             // Auction config pubkey
            &router_endpoints,                          // Router endpoints
            initialize_fixture.get_custodian_address(), // Custodian pubkey
            usdc_mint_address,                          // USDC mint pubkey
            transfer_direction,
        )
    }
}

impl ActiveAuctionState {
    // TODO: Figure this out
    pub async fn verify_initial_offer(&self, test_ctx: &Rc<RefCell<ProgramTestContext>>) {
        let auction_account = test_ctx
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
