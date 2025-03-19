// Add methods for adding endpoints to the program test

use super::constants::*;
use super::setup::TestingContext;
use super::token_account::create_token_account_for_pda;
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use anchor_lang::{InstructionData, ToAccountMetas};
use common::wormhole_cctp_solana::cctp::token_messenger_minter_program::RemoteTokenMessenger;
use matching_engine::accounts::{
    AddCctpRouterEndpoint as AddCctpRouterEndpointAccounts,
    AddLocalRouterEndpoint as AddLocalRouterEndpointAccounts, Admin, CheckedCustodian,
    LocalTokenRouter,
};
use matching_engine::instruction::{AddCctpRouterEndpoint, AddLocalRouterEndpoint};
use matching_engine::state::Custodian;
use matching_engine::state::EndpointInfo;
use matching_engine::state::RouterEndpoint;
use matching_engine::AddCctpRouterEndpointArgs;
use matching_engine::LOCAL_CUSTODY_TOKEN_SEED_PREFIX;
use solana_program_test::ProgramTestContext;
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::Transaction;
use solana_sdk::transaction::VersionedTransaction;
use std::cell::RefCell;
use std::rc::Rc;

fn generate_admin(owner_or_assistant: Pubkey, custodian: Pubkey) -> Admin {
    let checked_custodian = CheckedCustodian { custodian };
    Admin {
        owner_or_assistant,
        custodian: checked_custodian,
    }
}

#[allow(dead_code)]
async fn print_account_discriminator(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    address: &Pubkey,
) {
    println!("Printing account discriminator for address: {:?}", address);
    let account = test_context
        .borrow_mut()
        .banks_client
        .get_account(*address)
        .await
        .unwrap()
        .expect("Account not found");

    println!("Account data: {:?}", account.data);

    let account_owner = account.owner;
    println!("Account owner: {:?}", account_owner);

    // Get first 8 bytes (discriminator)
    let discriminator = &account.data[..8];
    println!("Account discriminator: {:?}", discriminator);

    // Compare with expected discriminator (WARNING: ASSUMPTION)
    let expected = RemoteTokenMessenger::discriminator();
    println!("Expected discriminator: {:?}", expected);
}

/// A struct representing an endpoint info for testing purposes
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct TestEndpointInfo {
    pub chain: u16,
    pub address: [u8; 32],
    pub mint_recipient: [u8; 32],
    pub protocol: matching_engine::state::MessageProtocol,
}

impl From<&EndpointInfo> for TestEndpointInfo {
    fn from(endpoint_info: &EndpointInfo) -> Self {
        Self {
            chain: endpoint_info.chain,
            address: endpoint_info.address,
            mint_recipient: endpoint_info.mint_recipient,
            protocol: endpoint_info.protocol,
        }
    }
}

impl TestEndpointInfo {
    pub fn new(
        chain: Chain,
        address: &Pubkey,
        mint_recipient: Option<&Pubkey>,
        protocol: matching_engine::state::MessageProtocol,
    ) -> Self {
        if let Some(mint_recipient) = mint_recipient {
            Self {
                chain: chain.to_chain_id(),
                address: address.to_bytes(),
                mint_recipient: mint_recipient.to_bytes(),
                protocol: protocol,
            }
        } else {
            Self {
                chain: chain.to_chain_id(),
                address: address.to_bytes(),
                mint_recipient: address.to_bytes(),
                protocol: protocol,
            }
        }
    }
}

pub struct TestRouterEndpoints {
    pub arbitrum: TestRouterEndpoint,
    pub ethereum: TestRouterEndpoint,
    pub solana: TestRouterEndpoint,
}

impl TestRouterEndpoints {
    pub fn new(
        arbitrum: TestRouterEndpoint,
        ethereum: TestRouterEndpoint,
        solana: TestRouterEndpoint,
    ) -> Self {
        Self {
            arbitrum,
            ethereum,
            solana,
        }
    }

    #[allow(dead_code)]
    pub fn get_endpoint_info(&self, chain: Chain) -> TestEndpointInfo {
        match chain {
            Chain::Arbitrum => self.arbitrum.info.clone(),
            Chain::Ethereum => self.ethereum.info.clone(),
            Chain::Solana => self.solana.info.clone(),
            _ => panic!("Unsupported chain"),
        }
    }

    #[allow(dead_code)]
    pub fn get_endpoint_address(&self, chain: Chain) -> Pubkey {
        match chain {
            Chain::Arbitrum => self.arbitrum.endpoint_address,
            Chain::Ethereum => self.ethereum.endpoint_address,
            Chain::Solana => self.solana.endpoint_address,
            _ => panic!("Unsupported chain"),
        }
    }
}

/// A struct representing a router endpoint for testing purposes
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct TestRouterEndpoint {
    pub endpoint_address: Pubkey,
    pub bump: u8,
    pub info: TestEndpointInfo,
}

impl From<(&RouterEndpoint, Pubkey)> for TestRouterEndpoint {
    fn from((router_endpoint, endpoint_address): (&RouterEndpoint, Pubkey)) -> Self {
        Self {
            endpoint_address,
            bump: router_endpoint.bump,
            info: (&router_endpoint.info).into(),
        }
    }
}

impl TestRouterEndpoint {
    pub fn verify_endpoint_info(
        &self,
        chain: Chain,
        address: &Pubkey,
        mint_recipient: Option<&Pubkey>,
        protocol: matching_engine::state::MessageProtocol,
    ) {
        let expected_info = TestEndpointInfo::new(chain, address, mint_recipient, protocol);
        assert_eq!(self.info, expected_info);
    }
}

pub fn get_router_endpoint_address(program_id: Pubkey, encoded_chain: &[u8; 2]) -> Pubkey {
    let (router_endpoint_address, _bump) =
        Pubkey::find_program_address(&[RouterEndpoint::SEED_PREFIX, encoded_chain], &program_id);
    router_endpoint_address
}

pub async fn add_cctp_router_endpoint_ix(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    admin_owner_or_assistant: Pubkey,
    admin_custodian: Pubkey,
    admin_keypair: &Keypair,
    program_id: Pubkey,
    remote_token_messenger: Pubkey,
    usdc_mint_address: Pubkey,
    chain: Chain,
) -> TestRouterEndpoint {
    let admin = generate_admin(admin_owner_or_assistant, admin_custodian);
    let usdc = matching_engine::accounts::Usdc {
        mint: usdc_mint_address,
    };

    let encoded_chain = (chain.to_chain_id() as u16).to_be_bytes();
    let router_endpoint_address = get_router_endpoint_address(program_id, &encoded_chain);

    let local_custody_token_address = Pubkey::find_program_address(
        &[LOCAL_CUSTODY_TOKEN_SEED_PREFIX, &encoded_chain],
        &program_id,
    )
    .0;

    let accounts = AddCctpRouterEndpointAccounts {
        payer: test_context.borrow().payer.pubkey(),
        admin,
        router_endpoint: router_endpoint_address,
        local_custody_token: local_custody_token_address,
        usdc,
        remote_token_messenger,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    };

    let registered_token_router_address: [u8; 32] = REGISTERED_TOKEN_ROUTERS[&chain]
        .clone()
        .try_into()
        .expect("Failed to convert registered token router address to bytes [u8; 32]");
    let ix_data = AddCctpRouterEndpoint {
        args: AddCctpRouterEndpointArgs {
            chain: chain.to_chain_id(),
            cctp_domain: CHAIN_TO_DOMAIN[chain as usize].1,
            address: registered_token_router_address,
            mint_recipient: None,
        },
    }
    .data();

    let instruction = Instruction {
        program_id: program_id,
        accounts: accounts.to_account_metas(None),
        data: ix_data,
    };

    let mut transaction =
        Transaction::new_with_payer(&[instruction], Some(&test_context.borrow().payer.pubkey()));
    // TODO: Figure out who the signers are
    let new_blockhash = test_context
        .borrow_mut()
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new blockhash");
    transaction.sign(
        &[&test_context.borrow().payer, &admin_keypair],
        new_blockhash,
    );

    let versioned_transaction = VersionedTransaction::try_from(transaction)
        .expect("Failed to convert transaction to versioned transaction");
    test_context
        .borrow_mut()
        .banks_client
        .process_transaction(versioned_transaction)
        .await
        .unwrap();

    let endpoint_account = test_context
        .borrow_mut()
        .banks_client
        .get_account(router_endpoint_address)
        .await
        .unwrap()
        .unwrap();

    let endpoint_data =
        RouterEndpoint::try_deserialize(&mut endpoint_account.data.as_slice()).unwrap();

    let test_router_endpoint = TestRouterEndpoint::from((&endpoint_data, router_endpoint_address));
    test_router_endpoint.verify_endpoint_info(
        chain,
        &Pubkey::new_from_array(registered_token_router_address),
        None,
        matching_engine::state::MessageProtocol::Cctp {
            domain: CHAIN_TO_DOMAIN[chain as usize].1,
        },
    );
    test_router_endpoint
}

pub async fn add_local_router_endpoint_ix(
    testing_context: &TestingContext,
    admin_owner_or_assistant: Pubkey,
    admin_custodian: Pubkey,
    admin_keypair: &Keypair,
) -> TestRouterEndpoint {
    let test_context = &testing_context.test_context;
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let program_id = testing_context.get_matching_engine_program_id();
    let admin = generate_admin(admin_owner_or_assistant, admin_custodian);

    let token_router_program = TOKEN_ROUTER_PID;
    let token_router_emitter =
        Pubkey::find_program_address(&[Custodian::SEED_PREFIX], &token_router_program).0;
    let token_router_mint_recipient =
        create_token_account_for_pda(test_context, &token_router_emitter, &usdc_mint_address).await;
    // Create the local token router
    let local_token_router = LocalTokenRouter {
        token_router_program,
        token_router_emitter: token_router_emitter.clone(),
        token_router_mint_recipient,
    };
    let chain = Chain::Solana;
    let encoded_chain = (chain.to_chain_id() as u16).to_be_bytes();
    let (router_endpoint_address, _bump) =
        Pubkey::find_program_address(&[RouterEndpoint::SEED_PREFIX, &encoded_chain], &program_id);

    // Create the router endpoint
    let accounts = AddLocalRouterEndpointAccounts {
        payer: test_context.borrow().payer.pubkey(),
        admin,
        router_endpoint: router_endpoint_address,
        local: local_token_router,
        system_program: anchor_lang::system_program::ID,
    };

    let ix_data = AddLocalRouterEndpoint {}.data();

    let instruction = Instruction {
        program_id: program_id,
        accounts: accounts.to_account_metas(None),
        data: ix_data,
    };

    let mut transaction =
        Transaction::new_with_payer(&[instruction], Some(&test_context.borrow().payer.pubkey()));
    let new_blockhash = test_context
        .borrow_mut()
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new blockhash");
    transaction.sign(
        &[&test_context.borrow().payer, &admin_keypair],
        new_blockhash,
    );

    let versioned_transaction = VersionedTransaction::try_from(transaction)
        .expect("Failed to convert transaction to versioned transaction");
    test_context
        .borrow_mut()
        .banks_client
        .process_transaction(versioned_transaction)
        .await
        .unwrap();

    let endpoint_account = test_context
        .borrow_mut()
        .banks_client
        .get_account(router_endpoint_address)
        .await
        .unwrap()
        .unwrap();

    let endpoint_data =
        RouterEndpoint::try_deserialize(&mut endpoint_account.data.as_slice()).unwrap();

    let test_router_endpoint = TestRouterEndpoint::from((&endpoint_data, router_endpoint_address));
    test_router_endpoint.verify_endpoint_info(
        chain,
        &token_router_emitter,
        Some(&token_router_mint_recipient),
        matching_engine::state::MessageProtocol::Local {
            program_id: token_router_program,
        },
    );
    test_router_endpoint
}

pub async fn create_cctp_router_endpoints_test(
    testing_context: &TestingContext,
    admin_owner_or_assistant: Pubkey,
    custodian_address: Pubkey,
    admin_keypair: Rc<Keypair>,
) -> [TestRouterEndpoint; 2] {
    let fixture_accounts = testing_context.get_fixture_accounts().unwrap();
    let usdc_mint_address = testing_context.get_usdc_mint_address();
    let program_id = testing_context.get_matching_engine_program_id();
    let arb_remote_token_messenger = fixture_accounts.arbitrum_remote_token_messenger;
    let test_context = &testing_context.test_context;
    let arb_chain = Chain::Arbitrum;
    let arbitrum_token_router_endpoint = add_cctp_router_endpoint_ix(
        test_context,
        admin_owner_or_assistant,
        custodian_address,
        admin_keypair.as_ref(),
        program_id,
        arb_remote_token_messenger,
        usdc_mint_address,
        arb_chain,
    )
    .await;

    let eth_chain = Chain::Ethereum;
    let eth_remote_token_messenger = fixture_accounts.ethereum_remote_token_messenger;
    let ethereum_token_router_endpoint = add_cctp_router_endpoint_ix(
        test_context,
        admin_owner_or_assistant,
        custodian_address,
        admin_keypair.as_ref(),
        program_id,
        eth_remote_token_messenger,
        usdc_mint_address,
        eth_chain,
    )
    .await;

    [
        arbitrum_token_router_endpoint,
        ethereum_token_router_endpoint,
    ]
}

pub async fn create_all_router_endpoints_test(
    testing_context: &TestingContext,
    admin_owner_or_assistant: Pubkey,
    custodian_address: Pubkey,
    admin_keypair: Rc<Keypair>,
) -> TestRouterEndpoints {
    let [arbitrum_token_router_endpoint, ethereum_token_router_endpoint] =
        create_cctp_router_endpoints_test(
            testing_context,
            admin_owner_or_assistant.clone(),
            custodian_address.clone(),
            admin_keypair.clone(),
        )
        .await;

    let local_token_router_endpoint = add_local_router_endpoint_ix(
        testing_context,
        admin_owner_or_assistant,
        custodian_address,
        admin_keypair.as_ref(),
    )
    .await;
    TestRouterEndpoints::new(
        arbitrum_token_router_endpoint,
        ethereum_token_router_endpoint,
        local_token_router_endpoint,
    )
}

pub async fn get_remote_token_messenger(
    test_context: &Rc<RefCell<ProgramTestContext>>,
    address: Pubkey,
) -> RemoteTokenMessenger {
    let remote_token_messenger_data = test_context
        .borrow_mut()
        .banks_client
        .get_account(address)
        .await
        .unwrap()
        .unwrap()
        .data;
    let remote_token_messenger =
        RemoteTokenMessenger::try_deserialize(&mut remote_token_messenger_data.as_ref()).unwrap();
    remote_token_messenger
}
