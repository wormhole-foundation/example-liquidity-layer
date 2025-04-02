use anchor_lang::prelude::*;
use solana_program_test::ProgramTestContext;

use super::router::TestRouterEndpoints;
use super::Chain;
use crate::testing_engine::setup::{TestingActor, TestingContext, TransferDirection};
use anyhow::{anyhow, Result as AnyhowResult};
use matching_engine::state::{Auction, AuctionInfo};
#[derive(Clone)]
pub struct AuctionAccounts {
    pub posted_fast_vaa: Option<Pubkey>,
    pub offer_token: Pubkey,
    pub actor: TestingActor,
    pub auction_config: Pubkey,
    pub from_router_endpoint: Pubkey,
    pub to_router_endpoint: Pubkey,
    pub custodian: Pubkey,
    pub usdc_mint: Pubkey,
}

/// An enum representing the state of an auction
///
/// # Fields
///
/// * `Active` - The auction is active
/// * `Settled` - The auction is settled
/// * `Inactive` - The auction is inactive
#[derive(Clone)]
pub enum AuctionState {
    Active(Box<ActiveAuctionState>),
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

/// A struct representing an active auction
///
/// # Fields
///
/// * `auction_address` - The address of the auction
/// * `auction_custody_token_address` - The address of the auction custody token
/// * `auction_config_address` - The address of the auction config
/// * `initial_offer` - The initial offer of the auction
/// * `best_offer` - The best offer of the auction
#[derive(Clone)]
pub struct ActiveAuctionState {
    pub auction_address: Pubkey,
    pub auction_custody_token_address: Pubkey,
    pub auction_config_address: Pubkey,
    pub initial_offer: AuctionOffer,
    pub best_offer: AuctionOffer,
}

/// A struct representing an auction offer
///
/// # Fields
///
/// * `participant` - The participant of the offer
/// * `offer_token` - The token of the offer
/// * `offer_price` - The price of the offer
#[derive(Clone)]
pub struct AuctionOffer {
    pub participant: Pubkey,
    pub offer_token: Pubkey,
    pub offer_price: u64,
}

impl AuctionAccounts {
    pub fn new(
        posted_fast_vaa: Option<Pubkey>,
        actor: TestingActor,
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
            TransferDirection::Other => {
                println!("Unsupported transfer direction, defaulting to FromEthereumToArbitrum");
                (
                    router_endpoints.get_endpoint_address(Chain::Ethereum),
                    router_endpoints.get_endpoint_address(Chain::Arbitrum),
                )
            }
        };
        Self {
            posted_fast_vaa,
            offer_token: actor.token_account_address().unwrap(),
            actor,
            auction_config,
            from_router_endpoint,
            to_router_endpoint,
            custodian,
            usdc_mint,
        }
    }
}

impl ActiveAuctionState {
    /// Verifies the auction state against the expected auction state
    ///
    /// # Arguments
    ///
    /// * `testing_context` - The testing context
    /// * `test_context` - The test context
    ///
    /// # Returns
    ///
    /// Result<()> - Panics if the auction state is not as expected or errors if the auction account is not found
    pub async fn verify_auction(
        &self,
        testing_context: &TestingContext,
        test_context: &mut ProgramTestContext,
    ) -> AnyhowResult<()> {
        let auction_account = test_context
            .banks_client
            .get_account(self.auction_address)
            .await?
            .expect("Failed to get auction account");
        let mut data_ref = auction_account.data.as_ref();
        let auction_account_data: Auction = AccountDeserialize::try_deserialize(&mut data_ref)?;
        let auction_info = auction_account_data.info.unwrap();

        let expected_auction_info = AuctionInfo {
            config_id: 0,            // Not tested against
            custody_token_bump: 254, // Not tested against
            vaa_sequence: 0,         // Not tested against
            source_chain: {
                match testing_context.transfer_direction {
                    TransferDirection::FromEthereumToArbitrum => 3,
                    TransferDirection::FromArbitrumToEthereum => 23,
                    TransferDirection::Other => {
                        return Err(anyhow!("Unsupported transfer direction"));
                    }
                }
            }, // Tested against
            best_offer_token: self.best_offer.offer_token, // Tested against
            initial_offer_token: self.initial_offer.offer_token, // Tested against
            start_slot: 1,           // Not tested against
            amount_in: 69000000,     // Not tested against
            security_deposit: 10545000, // Not tested against
            offer_price: self.best_offer.offer_price, // Tested against
            redeemer_message_len: 0, // Not tested against
            destination_asset_info: None, // Not tested against
        };
        assert_eq!(auction_info.config_id, expected_auction_info.config_id);

        assert_eq!(auction_info.start_slot, expected_auction_info.start_slot);

        assert_eq!(auction_info.offer_price, expected_auction_info.offer_price);
        assert_eq!(
            auction_info.best_offer_token,
            expected_auction_info.best_offer_token
        );
        assert_eq!(
            auction_info.initial_offer_token,
            expected_auction_info.initial_offer_token
        );
        Ok(())
    }
}

pub async fn compare_auctions(auction_1: &Auction, auction_2: &Auction) {
    let auction_1_info = auction_1.info.unwrap();
    let auction_2_info = auction_2.info.unwrap();
    assert_eq!(auction_1_info.config_id, auction_2_info.config_id);
    assert_eq!(
        auction_1_info.best_offer_token,
        auction_2_info.best_offer_token
    );
    assert_eq!(
        auction_1_info.initial_offer_token,
        auction_2_info.initial_offer_token
    );
    assert_eq!(auction_1_info.start_slot, auction_2_info.start_slot);
    assert_eq!(auction_1_info.offer_price, auction_2_info.offer_price);
}
