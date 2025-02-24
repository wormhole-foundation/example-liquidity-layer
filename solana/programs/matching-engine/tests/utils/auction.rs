use anchor_lang::prelude::*;

use matching_engine::state::{Auction, AuctionInfo};
use matching_engine::instruction::{PlaceInitialOfferCctp as PlaceInitialOfferCctpIx, ImproveOffer as ImproveOfferIx};
use matching_engine::accounts::{ActiveAuction, CheckedCustodian, FastOrderPath, LiquidityLayerVaa, LiveRouterEndpoint, LiveRouterPath, PlaceInitialOfferCctp as PlaceInitialOfferCctpAccounts, Usdc};
use matching_engine::accounts::ImproveOffer as ImproveOfferAccounts;
use solana_sdk::instruction::Instruction;
use std::cell::RefCell;
use std::rc::Rc;
use solana_program_test::ProgramTestContext;
use solana_sdk::transaction::Transaction;
use solana_sdk::signature::{Keypair, Signer};
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use anchor_lang::InstructionData;
use super::setup::Solver;
use super::vaa::TestVaa;

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

impl AuctionAccounts {
    pub fn new(fast_vaa: Option<Pubkey>, solver: Solver, auction_config: Pubkey, from_router_endpoint: Pubkey, to_router_endpoint: Pubkey, custodian: Pubkey, usdc_mint_address: Pubkey) -> Self {
        Self {
            fast_vaa,
            offer_token: solver.token_account_address().unwrap(),
            solver,
            auction_config,
            from_router_endpoint,
            to_router_endpoint,
            custodian,
            usdc_mint: usdc_mint_address,
        }
    }
}

pub struct AuctionOfferFixture {
    pub auction_address: Pubkey,
    pub auction_custody_token_address: Pubkey,
    pub offer_price: u64,
    pub offer_token: Pubkey,
}

impl AuctionOfferFixture {
    // TODO: Figure this out
    pub async fn verify_initial_offer(&self, testing_context: &Rc<RefCell<ProgramTestContext>>) {
        let auction_account = testing_context.borrow_mut().banks_client.get_account(self.auction_address).await.unwrap().expect("Failed to get auction account");
        let mut data_ref = auction_account.data.as_ref();
        let auction_account_data : Auction = AccountDeserialize::try_deserialize(&mut data_ref).unwrap();
        println!("Auction account: {:?}", auction_account_data);
        let auction_info = auction_account_data.info.unwrap();
        let expected_auction_info = AuctionInfo {
            config_id: 0,
            custody_token_bump: 254, // TODO: Figure this out
            vaa_sequence: 0,
            source_chain: 23,
            best_offer_token: pubkey!("3f3mimemFUZg6o7UuR7AXzt2B5Nh15beCczRPWg8oWnc"), // TODO: Figure this out, I think its the solver's ata
            initial_offer_token: pubkey!("3f3mimemFUZg6o7UuR7AXzt2B5Nh15beCczRPWg8oWnc"), // TODO: Figure this out, I think its the solver's ata
            start_slot: 1,
            amount_in: 1000,
            security_deposit: 1_004__200_005,
            offer_price: 1__000_000,
            redeemer_message_len: 0,
            destination_asset_info: None,
        };
        assert_eq!(auction_info.config_id, expected_auction_info.config_id);
        assert_eq!(auction_info.vaa_sequence, expected_auction_info.vaa_sequence);
        assert_eq!(auction_info.source_chain, expected_auction_info.source_chain);
        assert_eq!(auction_info.start_slot, expected_auction_info.start_slot);
        assert_eq!(auction_info.amount_in, expected_auction_info.amount_in);
        assert_eq!(auction_info.security_deposit, expected_auction_info.security_deposit);
        assert_eq!(auction_info.offer_price, expected_auction_info.offer_price);
        assert_eq!(auction_info.redeemer_message_len, expected_auction_info.redeemer_message_len);
    }
}

pub async fn place_initial_offer(
    testing_context: &Rc<RefCell<ProgramTestContext>>,
    accounts: &AuctionAccounts,
    fast_market_order: TestVaa,
    owner_keypair: Rc<Keypair>,
    program_id: Pubkey,
) -> AuctionOfferFixture {

    let auction_address = Pubkey::find_program_address(&[Auction::SEED_PREFIX, &fast_market_order.vaa_data.digest()], &program_id).0;
    let auction_custody_token_address = Pubkey::find_program_address(&[matching_engine::AUCTION_CUSTODY_TOKEN_SEED_PREFIX, auction_address.as_ref()], &program_id).0;
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
    {
        let fast_vaa_account = testing_context.borrow_mut().banks_client.get_account(fast_market_order.vaa_pubkey).await.unwrap().expect("Failed to get fast vaa account");
        println!("Fast VAA Account: {:?}", fast_vaa_account);
        println!("fast vaa owner: {:?}", fast_vaa_account.owner);
    }

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], &program_id).0;
    let transfer_authority = Pubkey::find_program_address(&[TRANSFER_AUTHORITY_SEED_PREFIX, &auction_address.to_bytes(), &initial_offer_ix.offer_price.to_be_bytes()], &program_id).0;
    accounts.solver.approve_usdc(testing_context, &transfer_authority, 420_000__000_000).await;
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
        usdc: Usdc { mint: accounts.usdc_mint },
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
    
    let initial_offer_ix_anchor = Instruction{
        program_id: program_id,
        accounts: account_metas,
        data: initial_offer_ix.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[initial_offer_ix_anchor],
        Some(&owner_keypair.pubkey()),
        &[&owner_keypair],
        testing_context.borrow().last_blockhash,
    );
    
    testing_context.borrow_mut().banks_client.process_transaction(tx).await.expect("Failed to place initial offer");

    AuctionOfferFixture {
        auction_address,
        auction_custody_token_address,
        offer_price: initial_offer_ix.offer_price,
        offer_token: accounts.offer_token,
    }
}



pub async fn improve_offer(
    testing_context: &Rc<RefCell<ProgramTestContext>>,
    initial_offer_fixture: AuctionOfferFixture,
    owner_keypair: Rc<Keypair>,
    program_id: Pubkey,
    solver: Solver,
    auction_config: Pubkey,
) -> AuctionOfferFixture {

    let auction_address = initial_offer_fixture.auction_address;
    let auction_custody_token_address = initial_offer_fixture.auction_custody_token_address;

    // Decrease the offer by 0.5 usdc
    let improve_offer_ix = ImproveOfferIx {
        offer_price: initial_offer_fixture.offer_price - 500_000,
    };

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], &program_id).0;
    let transfer_authority = Pubkey::find_program_address(&[TRANSFER_AUTHORITY_SEED_PREFIX, &auction_address.to_bytes(), &improve_offer_ix.offer_price.to_be_bytes()], &program_id).0;
    solver.approve_usdc(testing_context, &transfer_authority, 420_000__000_000).await;
    let offer_token = solver.token_account_address().unwrap();

    let active_auction = ActiveAuction {
        auction: auction_address,
        custody_token: auction_custody_token_address,
        config: auction_config,
        best_offer_token: initial_offer_fixture.offer_token,
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
        if meta.pubkey == initial_offer_fixture.offer_token {
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
        testing_context.borrow().last_blockhash,
    );
    
    testing_context.borrow_mut().banks_client.process_transaction(tx).await.expect("Failed to improve offer");

    AuctionOfferFixture {
        auction_address,
        auction_custody_token_address,
        offer_token,
        offer_price: improve_offer_ix.offer_price,
    }
}