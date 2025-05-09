use solana_program_test::ProgramTestContext;
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, signature::Signer, transaction::VersionedTransaction,
};

use anchor_lang::AccountDeserialize;
use anchor_spl::{associated_token::spl_associated_token_account, token::spl_token};
use solana_program::{bpf_loader_upgradeable, system_program};

use crate::{
    testing_engine::{
        config::{InitializeInstructionConfig, InstructionConfig},
        state::{InitializedState, TestingEngineState},
    },
    utils::token_account::SplTokenEnum,
};

use crate::testing_engine::setup::TestingContext;
use anchor_lang::{InstructionData, ToAccountMetas};
use matching_engine::{
    accounts::Initialize,
    state::{AuctionConfig, AuctionParameters, Custodian},
    InitializeArgs,
};

#[derive(Clone)]
pub struct InitializeAddresses {
    pub custodian_address: Pubkey,
    pub auction_config_address: Pubkey,
    pub cctp_mint_recipient: Pubkey,
}

impl InitializeAddresses {
    pub fn create(
        testing_context: &TestingContext,
        auction_parameters_config: &AuctionParametersConfig,
    ) -> Self {
        let program_id = testing_context.get_matching_engine_program_id();
        let cctp_mint_recipient = testing_context.get_cctp_mint_recipient();
        let (custodian, _custodian_bump) =
            Pubkey::find_program_address(&[Custodian::SEED_PREFIX], &program_id);

        let (auction_config, _auction_config_bump) = Pubkey::find_program_address(
            &[
                AuctionConfig::SEED_PREFIX,
                &auction_parameters_config.config_id.to_be_bytes(),
            ],
            &program_id,
        );

        Self {
            custodian_address: custodian,
            auction_config_address: auction_config,
            cctp_mint_recipient,
        }
    }
}

pub struct InitializeFixture {
    pub custodian: Custodian,
    pub addresses: InitializeAddresses,
}

#[derive(Debug, PartialEq, Eq)]
struct TestCustodian {
    owner: Pubkey,
    pending_owner: Option<Pubkey>,
    paused: bool,
    paused_set_by: Pubkey,
    owner_assistant: Pubkey,
    fee_recipient_token: Pubkey,
    auction_config_id: u32,
    next_proposal_id: u64,
}

impl From<&Custodian> for TestCustodian {
    fn from(c: &Custodian) -> Self {
        Self {
            owner: c.owner,
            pending_owner: c.pending_owner,
            paused: c.paused,
            paused_set_by: c.paused_set_by,
            owner_assistant: c.owner_assistant,
            fee_recipient_token: c.fee_recipient_token,
            auction_config_id: c.auction_config_id,
            next_proposal_id: c.next_proposal_id,
        }
    }
}

impl InitializeFixture {
    pub fn verify_custodian(
        &self,
        owner: Pubkey,
        owner_assistant: Pubkey,
        fee_recipient_token: Pubkey,
    ) {
        let expected_custodian = TestCustodian {
            owner,
            pending_owner: None,
            paused: false,
            paused_set_by: owner,
            owner_assistant,
            fee_recipient_token,
            auction_config_id: 0,
            next_proposal_id: 0,
        };

        let actual_custodian = TestCustodian::from(&self.custodian);
        assert_eq!(actual_custodian, expected_custodian);
    }
}

#[derive(Clone)]
pub struct AuctionParametersConfig {
    // Auction config iid used for seeding the auction config account
    pub config_id: u32,
    // Fields in the auction parameters account
    pub user_penalty_reward_bps: u32,
    pub initial_penalty_bps: u32,
    pub duration: u16,
    pub grace_period: u16,
    pub penalty_period: u16,
    pub min_offer_delta_bps: u32,
    pub security_deposit_base: u64,
    pub security_deposit_bps: u32,
}

impl Default for AuctionParametersConfig {
    fn default() -> Self {
        Self {
            config_id: 0,
            user_penalty_reward_bps: 250_000, // 25%
            initial_penalty_bps: 250_000,     // 25%
            duration: 2,
            grace_period: 5,
            penalty_period: 10,
            min_offer_delta_bps: 20_000, // 2%
            security_deposit_base: 4_200_000,
            security_deposit_bps: 5_000, // 0.5%
        }
    }
}

impl From<&AuctionParametersConfig> for AuctionParameters {
    fn from(val: &AuctionParametersConfig) -> Self {
        AuctionParameters {
            user_penalty_reward_bps: val.user_penalty_reward_bps,
            initial_penalty_bps: val.initial_penalty_bps,
            duration: val.duration,
            grace_period: val.grace_period,
            penalty_period: val.penalty_period,
            min_offer_delta_bps: val.min_offer_delta_bps,
            security_deposit_base: val.security_deposit_base,
            security_deposit_bps: val.security_deposit_bps,
        }
    }
}

pub async fn initialize_program(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    initial_state: &TestingEngineState,
    config: &InitializeInstructionConfig,
) -> TestingEngineState {
    let auction_parameters_config = config.auction_parameters_config.clone();
    let expected_error = config.expected_error();
    let expected_log_messages = config.expected_log_messages();
    let payer_signer = config
        .payer_signer
        .clone()
        .unwrap_or_else(|| testing_context.testing_actors.payer_signer.clone());
    // Create the initialize addresses
    let initialize_addresses =
        InitializeAddresses::create(testing_context, &auction_parameters_config);
    // Create the initialize instruction
    let instruction = initialize_program_instruction(testing_context, &auction_parameters_config);
    // Create and sign transaction
    let transaction = testing_context
        .create_transaction(
            test_context,
            &[instruction],
            Some(&payer_signer.pubkey()),
            &[
                &payer_signer,
                &testing_context.testing_actors.owner.keypair(),
            ],
            None,
            None,
        )
        .await;
    // Process transaction
    testing_context
        .execute_and_verify_transaction(test_context, transaction, expected_error)
        .await;

    if let Some(expected_log_messages) = expected_log_messages {
        // Recreate the instruction
        let instruction =
            initialize_program_instruction(testing_context, &auction_parameters_config);
        let transaction = testing_context
            .create_transaction(
                test_context,
                &[instruction],
                Some(&payer_signer.pubkey()),
                &[
                    &payer_signer,
                    &testing_context.testing_actors.owner.keypair(),
                ],
                None,
                None,
            )
            .await;
        let versioned_transaction = VersionedTransaction::from(transaction);

        // Simulate and verify logs
        testing_context
            .simulate_and_verify_logs(test_context, versioned_transaction, expected_log_messages)
            .await
            .expect("Failed to verify logs");
    }

    if expected_error.is_none() {
        // Verify the results
        let custodian_account = test_context
            .banks_client
            .get_account(initialize_addresses.custodian_address)
            .await
            .expect("Failed to get custodian account")
            .expect("Custodian account not found");

        let custodian = Custodian::try_deserialize(&mut custodian_account.data.as_slice()).unwrap();
        let initialize_fixture = InitializeFixture {
            custodian,
            addresses: initialize_addresses.clone(),
        };
        let testing_actors = &testing_context.testing_actors;
        let owner = testing_actors.owner.pubkey();
        let owner_assistant = testing_actors.owner_assistant.pubkey();
        let fee_recipient_token = testing_actors
            .fee_recipient
            .token_account_address(&SplTokenEnum::Usdc)
            .unwrap();

        initialize_fixture.verify_custodian(owner, owner_assistant, fee_recipient_token);
        TestingEngineState::Initialized {
            base: initial_state.base().clone(),
            initialized: InitializedState {
                auction_config_address: initialize_addresses.auction_config_address,
                custodian_address: initialize_addresses.custodian_address,
            },
        }
    } else {
        initial_state.clone()
    }
}

pub fn initialize_program_instruction(
    testing_context: &TestingContext,
    auction_parameters_config: &AuctionParametersConfig,
) -> Instruction {
    let program_id = testing_context.get_matching_engine_program_id();
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let initialize_addresses =
        InitializeAddresses::create(testing_context, &auction_parameters_config);
    let InitializeAddresses {
        custodian_address: custodian,
        auction_config_address: auction_config,
        cctp_mint_recipient,
    } = initialize_addresses;
    // Create AuctionParameters
    let auction_params: AuctionParameters = auction_parameters_config.into();

    // Create the instruction data
    let ix_data = matching_engine::instruction::Initialize {
        args: InitializeArgs { auction_params },
    };

    // Get account metas
    let accounts = Initialize {
        owner: testing_context.testing_actors.owner.pubkey(),
        custodian,
        auction_config,
        owner_assistant: testing_context.testing_actors.owner_assistant.pubkey(),
        fee_recipient: testing_context.testing_actors.fee_recipient.pubkey(),
        fee_recipient_token: testing_context
            .testing_actors
            .fee_recipient
            .token_account_address(&SplTokenEnum::Usdc)
            .unwrap(),
        cctp_mint_recipient,
        usdc: matching_engine::accounts::Usdc {
            mint: usdc_mint_address,
        },
        program_data: testing_context.program_data_account,
        upgrade_manager_authority: common::UPGRADE_MANAGER_AUTHORITY,
        upgrade_manager_program: common::UPGRADE_MANAGER_PROGRAM_ID,
        bpf_loader_upgradeable_program: bpf_loader_upgradeable::id(),
        system_program: system_program::id(),
        token_program: spl_token::id(),
        associated_token_program: spl_associated_token_account::id(),
    };

    // Create the instruction
    Instruction {
        program_id,
        accounts: accounts.to_account_metas(None),
        data: ix_data.data(),
    }
}
