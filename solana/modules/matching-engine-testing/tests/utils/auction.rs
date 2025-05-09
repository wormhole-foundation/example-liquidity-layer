use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use matching_engine::ID;
use solana_program_test::ProgramTestContext;

use super::Chain;
use super::{router::TestRouterEndpoints, token_account::SplTokenEnum};
use crate::testing_engine::config::TestingActorEnum;
use crate::testing_engine::setup::{TestingActor, TestingContext, TransferDirection};
use crate::testing_engine::state::TestingEngineState;
use anyhow::{anyhow, ensure, Result as AnyhowResult};
use matching_engine::state::{Auction, AuctionConfig, AuctionInfo};

/// A struct representing the accounts for an auction
///
/// # Fields
///
/// * `posted_fast_vaa` - The address of the posted fast VAA
/// * `offer_token` - The address of the offer token
/// * `actor` - The actor of the auction (who places the initial offer, improves it, executes it, or settles it)
/// * `auction_config` - The address of the auction config
/// * `from_router_endpoint` - The address of the router endpoint for the source chain
/// * `to_router_endpoint` - The address of the router endpoint for the destination chain
/// * `custodian` - The address of the custodian
/// * `usdc_mint` - The usdc mint address
#[derive(Clone)]
pub struct AuctionAccounts {
    pub posted_fast_vaa: Option<Pubkey>,
    pub offer_token: Pubkey,
    pub offer_actor: TestingActor,
    pub close_account_refund_recipient: Option<Pubkey>, // Only for shim
    pub auction_config: Pubkey,
    pub from_router_endpoint: Pubkey,
    pub to_router_endpoint: Pubkey,
    pub custodian: Pubkey,
    pub spl_token_enum: SplTokenEnum,
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
    Paused(Box<ActiveAuctionState>),
    Settled,
    Inactive,
}

impl AuctionState {
    pub fn get_active_auction(&self) -> Option<&ActiveAuctionState> {
        match self {
            AuctionState::Active(auction) => Some(auction),
            AuctionState::Paused(auction) => Some(auction),
            AuctionState::Inactive => None,
            AuctionState::Settled => None,
        }
    }

    pub fn set_pause(&self, is_paused: bool) -> Self {
        match self {
            AuctionState::Active(auction) => {
                if is_paused {
                    AuctionState::Paused(auction.clone())
                } else {
                    AuctionState::Active(auction.clone())
                }
            }
            AuctionState::Paused(auction) => {
                if is_paused {
                    AuctionState::Paused(auction.clone())
                } else {
                    AuctionState::Active(auction.clone())
                }
            }
            _ => self.clone(),
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
    pub spl_token_enum: SplTokenEnum,
}

#[derive(Debug)]
pub struct ExpectedTokenBalanceChanges {
    pub executor_token_balance_change: i32,
    pub best_offer_token_balance_change: i32,
    pub initial_offer_token_balance_change: i32,
}

/// A struct representing the calculations for an auction
#[derive(Debug)]
pub struct AuctionCalculations {
    pub penalty_amount: i32,
    pub user_reward: i32,
    pub security_deposit: i32,
    pub init_auction_fee: i32,
    pub min_offer_delta: u64,
    pub notional_security_deposit: u64,
    pub amount_in: i32, // Expose for easy access
    pub deposit_and_fee: i32,
    pub custody_token_balance_change: i32,
    pub expected_token_balance_changes: ExpectedTokenBalanceChanges,
    pub has_penalty: bool,
}

impl ActiveAuctionState {
    pub const BPS_DENOMINATOR: u64 = 1_000_000;

    pub fn fake_active_auction_state(auction_accounts: &AuctionAccounts) -> Self {
        Self {
            auction_address: Pubkey::new_unique(),
            auction_custody_token_address: Pubkey::new_unique(),
            auction_config_address: auction_accounts.auction_config,
            initial_offer: AuctionOffer::default(),
            best_offer: AuctionOffer::default(),
            spl_token_enum: auction_accounts.spl_token_enum.clone(),
        }
    }

    /// Computes the penalty amount and user reward for the auction
    ///
    /// # Arguments
    ///
    /// * `test_context` - The test context
    ///
    /// # Returns
    ///
    pub async fn get_auction_calculations(
        &self,
        test_context: &mut ProgramTestContext,
        executor_token_address: Pubkey,
        custodian_token_balance_previous: u64,
        init_auction_fee: u64,
    ) -> AuctionCalculations {
        let auction_info = helpers::get_auction_info(test_context, self.auction_address).await;
        let auction_config =
            helpers::get_auction_config(test_context, self.auction_config_address).await;

        let best_offer_token_account_exists =
            helpers::token_account_exists(test_context, self.best_offer.offer_token).await;

        let initial_offer_token_account_exists =
            helpers::token_account_exists(test_context, self.initial_offer.offer_token).await;

        let custody_token_balance = custodian_token_balance_previous;

        // Cast to u64 for math later
        let amount_in = auction_info.amount_in;
        let grace_period = u64::from(auction_config.grace_period);
        let auction_duration = u64::from(auction_config.duration);
        let initial_penalty_bps = u64::from(auction_config.initial_penalty_bps);
        let penalty_period = u64::from(auction_config.penalty_period);
        let user_penalty_reward_bps = u64::from(auction_config.user_penalty_reward_bps);
        let security_deposit = auction_info.security_deposit;
        let min_offer_delta_bps = u64::from(auction_config.min_offer_delta_bps);
        let security_deposit_bps = u64::from(auction_config.security_deposit_bps);

        let latest_slot = test_context.banks_client.get_root_slot().await.unwrap();
        let slots_elapsed = latest_slot
            .saturating_sub(auction_info.start_slot)
            .saturating_sub(auction_duration);
        let elapsed_penalty_period = slots_elapsed.saturating_sub(grace_period);
        let has_penalty = slots_elapsed >= grace_period;

        // Copy of computeDepositPenalty
        let (penalty_amount, user_reward) = if has_penalty {
            if elapsed_penalty_period >= penalty_period
                || initial_penalty_bps == Self::BPS_DENOMINATOR
            {
                let user_reward = security_deposit
                    .checked_mul(user_penalty_reward_bps)
                    .unwrap()
                    .checked_div(Self::BPS_DENOMINATOR)
                    .unwrap(); // security_deposit * user_penalty_reward_bps / BPS_DENOMINATOR
                (
                    security_deposit.checked_sub(user_reward).unwrap(), // security_deposit - user_reward
                    user_reward,                                        // user_reward
                )
            } else {
                let base_penalty = security_deposit
                    .checked_mul(initial_penalty_bps)
                    .unwrap()
                    .checked_div(Self::BPS_DENOMINATOR)
                    .unwrap(); // base_penalty = security_deposit * initial_penalty_bps / 10000
                let penalty_period_elapsed_penalty = security_deposit
                    .checked_sub(base_penalty)
                    .unwrap()
                    .checked_mul(elapsed_penalty_period)
                    .unwrap()
                    .checked_div(penalty_period)
                    .unwrap(); // (security_deposit - base_penalty) * elapsed_penalty_period / penalty_period
                let pre_penalty_amount = base_penalty
                    .checked_add(penalty_period_elapsed_penalty)
                    .unwrap(); // base_penalty + penalty_period_elapsed_penalty
                let user_reward = pre_penalty_amount
                    .checked_mul(user_penalty_reward_bps)
                    .unwrap()
                    .checked_div(Self::BPS_DENOMINATOR)
                    .unwrap(); // pre_penalty_amount * user_penalty_reward_bps / 10000
                (
                    pre_penalty_amount.checked_sub(user_reward).unwrap(),
                    user_reward,
                )
            }
        } else {
            (0, 0)
        };

        let min_offer_delta = self
            .best_offer
            .offer_price
            .checked_mul(min_offer_delta_bps)
            .unwrap()
            .checked_div(Self::BPS_DENOMINATOR)
            .unwrap();
        let notional_security_deposit = amount_in
            .checked_mul(security_deposit_bps)
            .unwrap()
            .checked_div(Self::BPS_DENOMINATOR)
            .unwrap();

        let mut executor_token_balance_change: i32 = 0;
        let mut best_offer_token_balance_change: i32 = 0;
        let mut initial_offer_token_balance_change: i32 = 0;

        let mut deposit_and_fee = if has_penalty {
            i32::try_from(
                security_deposit
                    .saturating_add(self.best_offer.offer_price)
                    .saturating_sub(user_reward),
            )
            .unwrap()
        } else {
            i32::try_from(security_deposit.saturating_add(self.best_offer.offer_price)).unwrap()
        };

        // Cast to i32 for math later
        let penalty_amount = i32::try_from(penalty_amount).unwrap();
        let user_reward = i32::try_from(user_reward).unwrap();
        let security_deposit = i32::try_from(security_deposit).unwrap();
        let offer_price = i32::try_from(auction_info.offer_price).unwrap();
        let amount_in = i32::try_from(amount_in).unwrap();
        let init_auction_fee = i32::try_from(init_auction_fee).unwrap();

        // Helper function to calculate the custody token balance change
        let new_custody_token_balance_calc =
            |custody_token_balance: u64, custody_token_balance_change: i32| {
                custody_token_balance.saturating_add_signed(custody_token_balance_change as i64)
                    as i32
            };

        // Find the custody token balance change

        // custody_token_balance_change = init_auction_fee + offer_price - amount_in
        let mut custody_token_balance_change = init_auction_fee
            .saturating_add(offer_price)
            .saturating_sub(amount_in);

        // If the best offer token is not the same as the initial offer token, and the initial offer token account exists, subtract the init auction fee
        if executor_token_address != self.initial_offer.offer_token
            && initial_offer_token_account_exists
        {
            // Don't give the init auction fee to the executor if the initial offer token exists and is not the same as the executor
            custody_token_balance_change =
                custody_token_balance_change.saturating_sub(init_auction_fee);
        }

        // If there is a penalty
        if has_penalty {
            // Subtract the user reward
            custody_token_balance_change = custody_token_balance_change.saturating_sub(user_reward);

            // If the executor token is the same as the best offer token, the custody token balance is given to the executor
            if executor_token_address == self.best_offer.offer_token {
                let balance_change = new_custody_token_balance_calc(
                    custody_token_balance,
                    custody_token_balance_change,
                );
                executor_token_balance_change = balance_change;
                best_offer_token_balance_change = balance_change;

                // If the all token accounts are the same, apply the same balance change to each of them
                if self.initial_offer.offer_token == self.best_offer.offer_token
                    && initial_offer_token_account_exists
                {
                    initial_offer_token_balance_change = balance_change;
                }

            // If there is a penalty and the executor token is not the same as the best offer token
            } else {
                // Subtract the penalty amount from the deposit and fee
                deposit_and_fee = deposit_and_fee.saturating_sub(penalty_amount);

                // If the best offer token account exists, subtract the deposit and fee from the custody token balance change
                if best_offer_token_account_exists {
                    custody_token_balance_change =
                        custody_token_balance_change.saturating_sub(deposit_and_fee);
                }

                // The remaining balance is given to the executor
                executor_token_balance_change = new_custody_token_balance_calc(
                    custody_token_balance,
                    custody_token_balance_change,
                );

                // If the initial offer token is the same as the best offer token, apply the same balance change to each of them
                if self.initial_offer.offer_token == self.best_offer.offer_token {
                    let balance_change = deposit_and_fee + init_auction_fee;
                    // This is sufficient, because either neither of them exist or both do
                    if best_offer_token_account_exists {
                        best_offer_token_balance_change = balance_change;
                        initial_offer_token_balance_change = balance_change;
                    };
                } else {
                    if best_offer_token_account_exists {
                        best_offer_token_balance_change = deposit_and_fee;
                    };
                    if initial_offer_token_account_exists {
                        if executor_token_address == self.initial_offer.offer_token {
                            initial_offer_token_balance_change = executor_token_balance_change;
                        } else {
                            initial_offer_token_balance_change = init_auction_fee;
                        }
                    }
                }
            }
        // If there is no penalty
        } else if self.best_offer.offer_token == self.initial_offer.offer_token
            && initial_offer_token_account_exists
        {
            let balance_change = deposit_and_fee + init_auction_fee;
            best_offer_token_balance_change = balance_change;
            initial_offer_token_balance_change = balance_change;
        } else {
            if best_offer_token_account_exists {
                best_offer_token_balance_change = deposit_and_fee;
            } else {
                executor_token_balance_change =
                    executor_token_balance_change.saturating_add(deposit_and_fee);
            }
            if initial_offer_token_account_exists {
                initial_offer_token_balance_change = init_auction_fee;
            } else {
                executor_token_balance_change =
                    executor_token_balance_change.saturating_add(init_auction_fee);
            }
        }

        let expected_token_balance_changes = ExpectedTokenBalanceChanges {
            executor_token_balance_change,
            best_offer_token_balance_change,
            initial_offer_token_balance_change,
        };

        AuctionCalculations {
            penalty_amount,
            user_reward,
            security_deposit,
            init_auction_fee,
            min_offer_delta,
            notional_security_deposit,
            amount_in,
            deposit_and_fee,
            custody_token_balance_change,
            expected_token_balance_changes,
            has_penalty,
        }
    }

    pub async fn get_auction_expiration_slot(&self, test_context: &mut ProgramTestContext) -> u64 {
        let auction_info = helpers::get_auction_info(test_context, self.auction_address).await;
        let auction_config =
            helpers::get_auction_config(test_context, self.auction_config_address).await;
        auction_info.start_slot
            + u64::from(auction_config.grace_period)
            + u64::from(auction_config.penalty_period)
    }

    pub async fn get_auction_grace_period_slot(
        &self,
        test_context: &mut ProgramTestContext,
    ) -> u64 {
        let auction_info = helpers::get_auction_info(test_context, self.auction_address).await;
        let auction_config =
            helpers::get_auction_config(test_context, self.auction_config_address).await;
        auction_info.start_slot
            + u64::from(auction_config.duration)
            + u64::from(auction_config.grace_period)
    }

    pub async fn get_auction_custody_token_balance(
        &self,
        test_context: &mut ProgramTestContext,
    ) -> u64 {
        helpers::get_token_account_balance(test_context, self.auction_custody_token_address).await
    }
}

/// A struct representing an auction offer
///
/// # Fields
///
/// * `participant` - The participant of the offer (the signer of the transaction)
/// * `offer_token` - The token of the offer
/// * `offer_price` - The price of the offer
#[derive(Clone, Default)]
pub struct AuctionOffer {
    pub actor: TestingActorEnum,
    pub participant: Pubkey,
    pub offer_token: Pubkey,
    pub offer_price: u64,
}

impl AuctionAccounts {
    pub fn fake_auction_accounts(
        current_state: &TestingEngineState,
        testing_context: &TestingContext,
    ) -> Self {
        let router_endpoints = current_state.router_endpoints().unwrap().endpoints.clone();
        let actor = testing_context.testing_actors.owner.clone();
        let transfer_direction = testing_context.transfer_direction;
        let auction_config = Pubkey::find_program_address(&[AuctionConfig::SEED_PREFIX], &ID).0;
        Self::new(
            None,
            actor,
            None,
            auction_config,
            &router_endpoints,
            Pubkey::new_unique(),
            SplTokenEnum::Usdc,
            transfer_direction,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new(
        posted_fast_vaa: Option<Pubkey>,
        offer_actor: TestingActor,
        close_account_refund_recipient: Option<Pubkey>,
        auction_config: Pubkey,
        router_endpoints: &TestRouterEndpoints,
        custodian: Pubkey,
        spl_token_enum: SplTokenEnum,
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
            offer_token: offer_actor.token_account_address(&spl_token_enum).unwrap(),
            close_account_refund_recipient,
            offer_actor,
            auction_config,
            from_router_endpoint,
            to_router_endpoint,
            custodian,
            spl_token_enum,
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
        ensure!(
            auction_info.config_id == expected_auction_info.config_id,
            "Auction config_id mismatch: expected {:?}, got {:?}",
            expected_auction_info.config_id,
            auction_info.config_id
        );

        ensure!(
            auction_info.start_slot == expected_auction_info.start_slot,
            "Auction start_slot mismatch: expected {}, got {}",
            expected_auction_info.start_slot,
            auction_info.start_slot
        );

        ensure!(
            auction_info.offer_price == expected_auction_info.offer_price,
            "Auction offer_price mismatch: expected {}, got {}",
            expected_auction_info.offer_price,
            auction_info.offer_price
        );

        ensure!(
            auction_info.best_offer_token == expected_auction_info.best_offer_token,
            "Auction best_offer_token mismatch: expected {:?}, got {:?}",
            expected_auction_info.best_offer_token,
            auction_info.best_offer_token
        );

        ensure!(
            auction_info.initial_offer_token == expected_auction_info.initial_offer_token,
            "Auction initial_offer_token mismatch: expected {:?}, got {:?}",
            expected_auction_info.initial_offer_token,
            auction_info.initial_offer_token
        );
        Ok(())
    }
}

/// Compares two auctions to assert they are equal
///
/// # Arguments
///
/// * `auction_1` - The first auction
/// * `auction_2` - The second auction
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

mod helpers {
    use super::*;

    pub async fn token_account_exists(
        test_context: &mut ProgramTestContext,
        token_address: Pubkey,
    ) -> bool {
        if let Some(account) = test_context
            .banks_client
            .get_account(token_address)
            .await
            .unwrap()
        {
            TokenAccount::try_deserialize(&mut &account.data[..]).is_ok()
        } else {
            false
        }
    }

    pub async fn get_auction_config(
        test_context: &mut ProgramTestContext,
        auction_config_address: Pubkey,
    ) -> AuctionConfig {
        let auction_config = test_context
            .banks_client
            .get_account(auction_config_address)
            .await
            .unwrap()
            .unwrap();
        let mut data_ref = auction_config.data.as_ref();
        let auction_config_data: AuctionConfig =
            AccountDeserialize::try_deserialize(&mut data_ref).unwrap();
        auction_config_data
    }

    pub async fn get_auction_info(
        test_context: &mut ProgramTestContext,
        auction_address: Pubkey,
    ) -> AuctionInfo {
        let auction = test_context
            .banks_client
            .get_account(auction_address)
            .await
            .unwrap()
            .unwrap();
        let mut data_ref = auction.data.as_ref();
        let auction_data: Auction = AccountDeserialize::try_deserialize(&mut data_ref).unwrap();
        auction_data.info.unwrap()
    }

    pub async fn get_token_account_balance(
        test_context: &mut ProgramTestContext,
        token_address: Pubkey,
    ) -> u64 {
        if let Some(token_account) = test_context
            .banks_client
            .get_account(token_address)
            .await
            .unwrap()
        {
            let mut data_ref = token_account.data.as_ref();
            let token_account_data: TokenAccount =
                AccountDeserialize::try_deserialize(&mut data_ref).unwrap();
            token_account_data.amount
        } else {
            0
        }
    }
}
