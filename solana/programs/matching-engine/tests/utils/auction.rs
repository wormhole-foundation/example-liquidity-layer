use anchor_lang::prelude::*;

use super::router::TestRouterEndpoints;
use super::setup::{Solver, TestingContext, TransferDirection};
use super::Chain;
use matching_engine::state::{Auction, AuctionInfo};

#[derive(Clone)]
pub struct AuctionAccounts {
    pub posted_fast_vaa: Option<Pubkey>,
    pub offer_token: Pubkey,
    pub solver: Solver,
    pub auction_config: Pubkey,
    pub from_router_endpoint: Pubkey,
    pub to_router_endpoint: Pubkey,
    pub custodian: Pubkey,
    pub usdc_mint: Pubkey,
}

#[derive(Clone)]
pub enum AuctionState {
    Active(ActiveAuctionState),
    Settled,
    Inactive,
}

impl AuctionState {
    pub fn get_active_auction(&self) -> Option<&ActiveAuctionState> {
        match self {
            AuctionState::Active(auction) => Some(auction),
            AuctionState::Inactive => None,
            AuctionState::Settled => None,
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
    pub participant: Pubkey,
    pub offer_token: Pubkey,
    pub offer_price: u64,
}

impl AuctionAccounts {
    pub fn new(
        posted_fast_vaa: Option<Pubkey>,
        solver: Solver,
        auction_config: Pubkey,
        router_endpoints: &TestRouterEndpoints,
        custodian: Pubkey,
        usdc_mint: Pubkey,
        direction: TransferDirection,
    ) -> Self {
        let (from_router_endpoint, to_router_endpoint) = match direction {
            TransferDirection::FromEthereumToArbitrum => (
                router_endpoints.get_endpoint_address(Chain::Ethereum),
                router_endpoints.get_endpoint_address(Chain::Arbitrum),
            ),
            TransferDirection::FromArbitrumToEthereum => (
                router_endpoints.get_endpoint_address(Chain::Arbitrum),
                router_endpoints.get_endpoint_address(Chain::Ethereum),
            ),
            _ => panic!("Unsupported transfer direction"),
        };
        Self {
            posted_fast_vaa,
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
    pub async fn verify_auction(&self, testing_context: &TestingContext) {
        let test_ctx = &testing_context.test_context;
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
            config_id: 0,            // TODO: Figure this out
            custody_token_bump: 254, // TODO: Figure this out
            vaa_sequence: 0,         // No need to cehck against this
            source_chain: {
                match testing_context.testing_state.transfer_direction {
                    TransferDirection::FromEthereumToArbitrum => 3,
                    TransferDirection::FromArbitrumToEthereum => 23,
                    _ => panic!("Unsupported transfer direction"),
                }
            },
            best_offer_token: self.best_offer.offer_token,
            initial_offer_token: self.initial_offer.offer_token,
            start_slot: 1,
            amount_in: 69000000,
            security_deposit: 10545000,
            offer_price: self.best_offer.offer_price,
            redeemer_message_len: 0,
            destination_asset_info: None,
        };
        assert_eq!(auction_info.config_id, expected_auction_info.config_id);

        assert_eq!(auction_info.start_slot, expected_auction_info.start_slot);

        assert_eq!(auction_info.offer_price, expected_auction_info.offer_price);
        assert_eq!(
            auction_info.redeemer_message_len,
            expected_auction_info.redeemer_message_len
        );
    }
}
