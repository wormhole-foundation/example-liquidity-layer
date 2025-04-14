//! # Testing Engine State
//!
//! This module contains the state for the testing engine.
//! It is used to store the state of the testing engine.
//!
//! ## Examples
//!
//! ```
//! use crate::testing_engine::state::*;
//!
//! let testing_engine_state = TestingEngineState::Uninitialized(BaseState::default());
//! // Use the testing engine state to test the instructions and move through the states
//! ```

use super::{config::TestingActorEnum, setup::TransferDirection};
use crate::utils::{
    account_fixtures::FixtureAccounts,
    auction::{AuctionAccounts, AuctionState},
    router::TestRouterEndpoints,
    token_account::SplTokenEnum,
    vaa::{TestVaaPair, TestVaaPairs},
};
use anchor_lang::prelude::*;
use matching_engine::state::FastMarketOrder;

// Base state containing common data
#[derive(Clone)]
pub struct BaseState {
    pub fixture_accounts: FixtureAccounts,
    pub vaas: TestVaaPairs,
    pub transfer_direction: TransferDirection,
}

impl BaseState {
    pub fn get_fast_market_order(&self, index: usize) -> Option<common::messages::FastMarketOrder> {
        self.vaas.get(index).map(|vaa| {
            vaa.fast_transfer_vaa
                .get_payload_deserialized()
                .unwrap()
                .get_fast_transfer()
                .unwrap()
        })
    }
}

// Each state contains its specific data
#[derive(Clone)]
pub struct InitializedState {
    pub auction_config_address: Pubkey,
    pub custodian_address: Pubkey,
}

#[derive(Clone)]
pub struct RouterEndpointsState {
    pub endpoints: TestRouterEndpoints,
}

#[derive(Clone)]
pub struct FastMarketOrderAccountCreatedState {
    pub fast_market_order_address: Pubkey,
    pub fast_market_order_bump: u8,
    pub fast_market_order: FastMarketOrder,
    pub close_account_refund_recipient: Pubkey,
}

#[derive(Clone)]
pub struct InitialOfferPlacedState {
    pub auction_state: AuctionState,
    pub auction_accounts: AuctionAccounts,
}

#[derive(Clone)]
pub struct OfferImprovedState {
    pub auction_state: AuctionState,
}

#[derive(Clone)]
pub struct OrderExecutedState {
    pub cctp_message: Pubkey,
    pub post_message_sequence: Option<Pubkey>, // Only set if shimful execution
    pub post_message_message: Option<Pubkey>,  // Only set if shimful execution
    pub actor_enum: TestingActorEnum,
}

#[derive(Clone)]
pub struct OrderPreparedState {
    pub prepared_order_response_address: Pubkey,
    pub prepared_custody_token: Pubkey,
    pub base_fee_token: Pubkey,
    pub actor_enum: TestingActorEnum,
}

#[derive(Clone)]
pub struct GuardianSetState {
    pub guardian_set_address: Pubkey,
    pub guardian_signatures_address: Pubkey,
}

// The main state enum that reflects all possible instruction states
#[derive(Clone)]
pub enum TestingEngineState {
    Uninitialized(BaseState),
    Initialized {
        base: BaseState,
        initialized: InitializedState,
    },
    RouterEndpointsCreated {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
    },
    FastMarketOrderAccountCreated {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: Option<RouterEndpointsState>,
        fast_market_order: FastMarketOrderAccountCreatedState,
        guardian_set_state: GuardianSetState,
        auction_state: AuctionState,
        auction_accounts: Option<AuctionAccounts>,
    },
    InitialOfferPlaced {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        auction_state: AuctionState,
        auction_accounts: AuctionAccounts,
    },
    OfferImproved {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        auction_state: AuctionState,
        auction_accounts: Option<AuctionAccounts>,
    },
    OrderExecuted {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        auction_state: AuctionState,
        order_executed: OrderExecutedState,
        auction_accounts: AuctionAccounts,
    },
    OrderPrepared {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        auction_state: AuctionState,
        order_prepared: OrderPreparedState,
        auction_accounts: AuctionAccounts,
    },
    AuctionSettled {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: RouterEndpointsState,
        auction_state: AuctionState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        order_prepared: OrderPreparedState,
        auction_accounts: Option<AuctionAccounts>,
        order_executed: Option<OrderExecutedState>,
    },
    FastMarketOrderClosed {
        base: BaseState,
        initialized: InitializedState,
        router_endpoints: Option<RouterEndpointsState>,
        auction_state: AuctionState,
        fast_market_order: Option<FastMarketOrderAccountCreatedState>,
        order_prepared: Option<OrderPreparedState>,
        auction_accounts: Option<AuctionAccounts>,
        order_executed: Option<OrderExecutedState>,
    },
}

// Implement accessors for common data
impl TestingEngineState {
    // Base state accessor
    pub fn base(&self) -> &BaseState {
        match self {
            Self::Uninitialized(state) => state,
            Self::Initialized { base, .. } => base,
            Self::RouterEndpointsCreated { base, .. } => base,
            Self::FastMarketOrderAccountCreated { base, .. } => base,
            Self::InitialOfferPlaced { base, .. } => base,
            Self::OfferImproved { base, .. } => base,
            Self::OrderExecuted { base, .. } => base,
            Self::OrderPrepared { base, .. } => base,
            Self::AuctionSettled { base, .. } => base,
            Self::FastMarketOrderClosed { base, .. } => base,
        }
    }

    // Initialization data accessor
    pub fn initialized(&self) -> Option<&InitializedState> {
        match self {
            Self::Uninitialized(_) => None,
            Self::Initialized { initialized, .. } => Some(initialized),
            Self::RouterEndpointsCreated { initialized, .. } => Some(initialized),
            Self::FastMarketOrderAccountCreated { initialized, .. } => Some(initialized),
            Self::InitialOfferPlaced { initialized, .. } => Some(initialized),
            Self::OfferImproved { initialized, .. } => Some(initialized),
            Self::OrderExecuted { initialized, .. } => Some(initialized),
            Self::OrderPrepared { initialized, .. } => Some(initialized),
            Self::AuctionSettled { initialized, .. } => Some(initialized),
            Self::FastMarketOrderClosed { initialized, .. } => Some(initialized),
        }
    }

    // Router endpoints accessor
    pub fn router_endpoints(&self) -> Option<&RouterEndpointsState> {
        match self {
            Self::Uninitialized(_) | Self::Initialized { .. } => None,
            Self::RouterEndpointsCreated {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::FastMarketOrderAccountCreated {
                router_endpoints, ..
            } => router_endpoints.as_ref(),
            Self::InitialOfferPlaced {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::OfferImproved {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::OrderExecuted {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::OrderPrepared {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::AuctionSettled {
                router_endpoints, ..
            } => Some(router_endpoints),
            Self::FastMarketOrderClosed {
                router_endpoints, ..
            } => router_endpoints.as_ref(),
        }
    }

    // Fast market order accessor
    pub fn fast_market_order(&self) -> Option<&FastMarketOrderAccountCreatedState> {
        match self {
            Self::FastMarketOrderAccountCreated {
                fast_market_order, ..
            } => Some(fast_market_order),
            Self::InitialOfferPlaced {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            Self::OfferImproved {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            Self::OrderExecuted {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            Self::AuctionSettled {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            Self::OrderPrepared {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            Self::FastMarketOrderClosed {
                fast_market_order, ..
            } => fast_market_order.as_ref(),
            _ => None,
        }
    }

    // Auction state accessor
    pub fn auction_state(&self) -> &AuctionState {
        match self {
            Self::InitialOfferPlaced { auction_state, .. } => auction_state,
            Self::OfferImproved { auction_state, .. } => auction_state,
            Self::OrderExecuted { auction_state, .. } => auction_state,
            Self::OrderPrepared { auction_state, .. } => auction_state,
            Self::AuctionSettled { auction_state, .. } => auction_state,
            Self::FastMarketOrderClosed { auction_state, .. } => auction_state,
            Self::FastMarketOrderAccountCreated { auction_state, .. } => auction_state,
            _ => &AuctionState::Inactive,
        }
    }

    pub fn auction_accounts(&self) -> Option<&AuctionAccounts> {
        match self {
            Self::InitialOfferPlaced {
                auction_accounts, ..
            } => Some(auction_accounts),
            Self::OfferImproved {
                auction_accounts, ..
            } => auction_accounts.as_ref(),
            Self::OrderExecuted {
                auction_accounts, ..
            } => Some(auction_accounts),
            Self::OrderPrepared {
                auction_accounts, ..
            } => Some(auction_accounts),
            Self::AuctionSettled {
                auction_accounts, ..
            } => auction_accounts.as_ref(),
            Self::FastMarketOrderClosed {
                auction_accounts, ..
            } => auction_accounts.as_ref(),
            Self::FastMarketOrderAccountCreated {
                auction_accounts, ..
            } => auction_accounts.as_ref(),
            _ => None,
        }
    }

    pub fn initial_offer_placed_actor(&self) -> Option<TestingActorEnum> {
        self.auction_state()
            .get_active_auction()
            .map(|auction| auction.initial_offer.actor)
    }

    pub fn best_offer_actor(&self) -> Option<TestingActorEnum> {
        self.auction_state()
            .get_active_auction()
            .map(|auction| auction.best_offer.actor)
    }

    pub fn execute_order_actor(&self) -> Option<TestingActorEnum> {
        self.order_executed()
            .map(|order_executed| order_executed.actor_enum)
    }

    // Prepared order accessor
    pub fn order_prepared(&self) -> Option<&OrderPreparedState> {
        match self {
            Self::OrderPrepared { order_prepared, .. } => Some(order_prepared),
            Self::AuctionSettled { order_prepared, .. } => Some(order_prepared),
            Self::FastMarketOrderClosed { order_prepared, .. } => order_prepared.as_ref(),
            _ => None,
        }
    }

    pub fn order_executed(&self) -> Option<&OrderExecutedState> {
        match self {
            Self::AuctionSettled { order_executed, .. } => order_executed.as_ref(),
            Self::OrderExecuted { order_executed, .. } => Some(order_executed),
            _ => None,
        }
    }

    pub fn get_first_test_vaa_pair(&self) -> &TestVaaPair {
        self.base().vaas.first().unwrap()
    }

    // Convenience methods for common fields
    pub fn custodian_address(&self) -> Option<Pubkey> {
        self.initialized().map(|state| state.custodian_address)
    }

    pub fn auction_config_address(&self) -> Option<Pubkey> {
        self.initialized().map(|state| state.auction_config_address)
    }

    pub fn spl_token_enum(&self) -> Option<SplTokenEnum> {
        self.auction_accounts()
            .map(|accounts| accounts.spl_token_enum.clone())
    }

    pub fn close_account_refund_recipient(&self) -> Option<Pubkey> {
        self.fast_market_order()
            .map(|fast_market_order| fast_market_order.close_account_refund_recipient)
    }

    pub fn set_auction_state(&self, new_auction_state: AuctionState) -> anyhow::Result<Self> {
        match self {
            Self::FastMarketOrderAccountCreated {
                base,
                initialized,
                router_endpoints,
                fast_market_order,
                guardian_set_state,
                auction_state: _, // Ignore the current auction state
                auction_accounts,
            } => Ok(Self::FastMarketOrderAccountCreated {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                fast_market_order: fast_market_order.clone(),
                guardian_set_state: guardian_set_state.clone(),
                auction_state: new_auction_state, // Use the new auction state
                auction_accounts: auction_accounts.clone(),
            }),

            Self::InitialOfferPlaced {
                base,
                initialized,
                router_endpoints,
                fast_market_order,
                auction_state: _, // Ignore the current auction state
                auction_accounts,
            } => Ok(Self::InitialOfferPlaced {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                fast_market_order: fast_market_order.clone(),
                auction_state: new_auction_state, // Use the new auction state
                auction_accounts: auction_accounts.clone(),
            }),

            Self::OfferImproved {
                base,
                initialized,
                router_endpoints,
                fast_market_order,
                auction_state: _, // Ignore the current auction state
                auction_accounts,
            } => Ok(Self::OfferImproved {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                fast_market_order: fast_market_order.clone(),
                auction_state: new_auction_state, // Use the new auction state
                auction_accounts: auction_accounts.clone(),
            }),

            Self::OrderExecuted {
                base,
                initialized,
                router_endpoints,
                fast_market_order,
                auction_state: _, // Ignore the current auction state
                order_executed,
                auction_accounts,
            } => Ok(Self::OrderExecuted {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                fast_market_order: fast_market_order.clone(),
                auction_state: new_auction_state, // Use the new auction state
                order_executed: order_executed.clone(),
                auction_accounts: auction_accounts.clone(),
            }),

            Self::OrderPrepared {
                base,
                initialized,
                router_endpoints,
                fast_market_order,
                auction_state: _, // Ignore the current auction state
                order_prepared,
                auction_accounts,
            } => Ok(Self::OrderPrepared {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                fast_market_order: fast_market_order.clone(),
                auction_state: new_auction_state, // Use the new auction state
                order_prepared: order_prepared.clone(),
                auction_accounts: auction_accounts.clone(),
            }),

            Self::AuctionSettled {
                base,
                initialized,
                router_endpoints,
                auction_state: _, // Ignore the current auction state
                fast_market_order,
                order_prepared,
                auction_accounts,
                order_executed,
            } => Ok(Self::AuctionSettled {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                auction_state: new_auction_state, // Use the new auction state
                fast_market_order: fast_market_order.clone(),
                order_prepared: order_prepared.clone(),
                auction_accounts: auction_accounts.clone(),
                order_executed: order_executed.clone(),
            }),

            Self::FastMarketOrderClosed {
                base,
                initialized,
                router_endpoints,
                auction_state: _, // Ignore the current auction state
                fast_market_order,
                order_prepared,
                auction_accounts,
                order_executed,
            } => Ok(Self::FastMarketOrderClosed {
                base: base.clone(),
                initialized: initialized.clone(),
                router_endpoints: router_endpoints.clone(),
                auction_state: new_auction_state, // Use the new auction state
                fast_market_order: fast_market_order.clone(),
                order_prepared: order_prepared.clone(),
                auction_accounts: auction_accounts.clone(),
                order_executed: order_executed.clone(),
            }),

            // For states that don't have an auction_state field
            _ => anyhow::bail!("Cannot set auction state for this state: no auction state exists"),
        }
    }
}
