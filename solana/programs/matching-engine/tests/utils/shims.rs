use anchor_lang::prelude::*;
use common::messages::FastMarketOrder;
use wormhole_io::TypePrefixedPayload;
use super::{constants::*, setup::Solver};
use wormhole_svm_shim::{post_message, verify_vaa};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    hash::Hash,
    message::{v0::Message, VersionedMessage},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, VersionedTransaction},
};
use solana_program_test::ProgramTestContext;
use std::{rc::Rc, str::FromStr};
use std::cell::RefCell;
use wormhole_svm_definitions::{
    solana::Finality,
    find_emitter_sequence_address,
    find_shim_message_address,
};
use base64::Engine;
use matching_engine::state::{Auction, FastMarketOrder as FastMarketOrderState};
use matching_engine::fallback::place_initial_offer::{
    PlaceInitialOfferCctpShim as PlaceInitialOfferCctpShimFallback,
    PlaceInitialOfferCctpShimAccounts as PlaceInitialOfferCctpShimFallbackAccounts,
    PlaceInitialOfferCctpShimData as PlaceInitialOfferCctpShimFallbackData,
};
use matching_engine::fallback::initialise_fast_market_order::{
    InitialiseFastMarketOrder as InitialiseFastMarketOrderFallback,
    InitialiseFastMarketOrderAccounts as InitialiseFastMarketOrderFallbackAccounts,
    InitialiseFastMarketOrderData as InitialiseFastMarketOrderFallbackData,
};
use wormhole_svm_definitions::borsh::GuardianSignatures;

#[allow(dead_code)]
struct BumpCosts {
    message: u64,
    sequence: u64,
}

fn bump_cu_cost(bump: u8) -> u64 {
    1_500 * (255 - u64::from(bump))
}

#[allow(dead_code)]
const EMITTER_SEQUENCE_SEED: &[u8] = b"Sequence";

pub async fn set_up_post_message_transaction_test(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, emitter_signer: &Rc<Keypair>, recent_blockhash: Hash) {
    let (transaction, _bump_costs) = set_up_post_message_transaction(
        b"All your base are belong to us",
        &payer_signer.clone().to_owned(),
        &emitter_signer.clone().to_owned(),
        recent_blockhash,
    );
    let details = {
        let out = test_ctx.borrow_mut().banks_client
            .simulate_transaction(transaction)
            .await
            .unwrap();
        assert!(out.result.clone().unwrap().is_ok(), "{:?}", out.result);
        out.simulation_details.unwrap()
    };
    let logs = details.logs;
    let is_core_bridge_cpi_log = |line: &String| {
        line.contains(format!("Program {} invoke [2]", CORE_BRIDGE_PID).as_str())
    };
    // CPI to Core Bridge.
    assert_eq!(
        logs.iter()
            .filter(|line| {
                line.contains(format!("Program {} invoke [2]", CORE_BRIDGE_PID).as_str())
            })
            .count(),
        1
    );
    assert_eq!(
        logs.iter()
            .filter(|line| { line.contains("Program log: Sequence: 0") })
            .count(),
        1
    );
    let core_bridge_log_index = logs.iter().position(is_core_bridge_cpi_log).unwrap();

    // Self CPI.
    assert_eq!(
        logs.iter()
            .skip(core_bridge_log_index)
            .filter(|line| {
                line.contains(
                    format!("Program {} invoke [2]", WORMHOLE_POST_MESSAGE_SHIM_PID).as_str(),
                )
            })
            .count(),
        1
    );

}

fn set_up_post_message_transaction(
    payload: &[u8],
    payer_signer: &Keypair,
    emitter_signer: &Keypair,
    recent_blockhash: Hash,
) -> (VersionedTransaction, BumpCosts) {
    let emitter = emitter_signer.pubkey();
    let payer = payer_signer.pubkey();

    // Use an invalid message if provided.
    let (message, message_bump) = find_shim_message_address(
            &emitter,
            &WORMHOLE_POST_MESSAGE_SHIM_PID,
    );

    // Use an invalid core bridge program if provided.
    let core_bridge_program = CORE_BRIDGE_PID;

    let (sequence, sequence_bump) =
        find_emitter_sequence_address(&emitter, &core_bridge_program);

    let transfer_fee_ix =
        solana_sdk::system_instruction::transfer(&payer, &CORE_BRIDGE_FEE_COLLECTOR, 100);
    let post_message_ix = post_message::PostMessage {
        program_id: &WORMHOLE_POST_MESSAGE_SHIM_PID,
        accounts: post_message::PostMessageAccounts {
            emitter: &emitter,
            payer: &payer,
            wormhole_program_id: &core_bridge_program,
            derived: post_message::PostMessageDerivedAccounts {
                message: Some(&message),
                sequence: Some(&sequence),
                ..Default::default()
            },
        },
        data: post_message::PostMessageData::new(
            420,
            Finality::Finalized,
            payload,
        )
        .unwrap(),
    }
    .instruction();

    // Adding compute budget instructions to ensure all instructions fit into
    // one transaction.
    //
    // NOTE: Invoking the compute budget costs in total 300 CU.
    let message = Message::try_compile(
        &payer,
        &[
            transfer_fee_ix,
            post_message_ix,
            ComputeBudgetInstruction::set_compute_unit_price(420),
            ComputeBudgetInstruction::set_compute_unit_limit(100_000),
        ],
        &[],
        recent_blockhash,
    )
    .unwrap();

    let transaction = VersionedTransaction::try_new(
        VersionedMessage::V0(message),
        &[payer_signer, emitter_signer],
    )
    .unwrap();

    (
        transaction,
        BumpCosts {
            message: bump_cu_cost(message_bump),
            sequence: bump_cu_cost(sequence_bump),
        },
    )
}

pub async fn add_guardian_signatures_account(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, signatures_signer: &Rc<Keypair>, guardian_signatures: Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]>, guardian_set_index: u32) -> Result<Pubkey> {
    let new_blockhash = test_ctx.borrow_mut().get_new_latest_blockhash().await.expect("Failed to get new blockhash");
    let transaction = post_signatures_transaction(payer_signer, signatures_signer, guardian_set_index, guardian_signatures.len() as u8, &guardian_signatures, new_blockhash);
    test_ctx.borrow_mut().banks_client.process_transaction(transaction).await.expect("Failed to add guardian signatures account");
    
    Ok(signatures_signer.pubkey())
}

#[allow(dead_code)]
/// Post signatures before the auction is created.
pub async fn set_up_verify_shims_test(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>) -> Result<Pubkey> {
    let guardian_signatures_signer = Rc::new(Keypair::new());
    let (transaction, decoded_vaa)= set_up_verify_shims_transaction(test_ctx, payer_signer, &guardian_signatures_signer);

    let _details = {
        let out = test_ctx.borrow_mut().banks_client
            .simulate_transaction(transaction.clone())
            .await
            .unwrap();
        assert!(out.result.clone().unwrap().is_ok(), "{:?}", out.result);
        assert_eq!(
            out.simulation_details.clone().unwrap().units_consumed,
            // 13_355
            3_337
        );
        out.simulation_details.unwrap()
    };

    {
        let out = test_ctx.borrow_mut().banks_client
            .process_transaction(transaction)
            .await;
        assert!(out.is_ok());
        out.unwrap();
    };

    // Check guardian signatures account after processing the transaction.
    let guardian_signatures_info = test_ctx.borrow_mut().banks_client
        .get_account(guardian_signatures_signer.pubkey())
        .await
        .unwrap()
        .unwrap();

    let account_data = &guardian_signatures_info.data;
    let (expected_length, expected_guardian_signatures_data) =
        generate_expected_guardian_signatures_info(
            &payer_signer.pubkey(),
            decoded_vaa.total_signatures,
            decoded_vaa.guardian_set_index,
            decoded_vaa.guardian_signatures,
        );

    assert_eq!(account_data.len(), expected_length);
    assert_eq!(
        wormhole_svm_definitions::borsh::deserialize_with_discriminator::<wormhole_svm_definitions::borsh::GuardianSignatures>(&account_data[..]).unwrap(),
        expected_guardian_signatures_data
    );
    Ok(guardian_signatures_signer.pubkey())
}

#[derive(Clone)]
#[allow(dead_code)]
struct DecodedVaa {
    pub guardian_set_index: u32,
    pub total_signatures: u8,
    pub guardian_signatures: Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]>,
    pub body: Vec<u8>,
}

impl From<&str> for DecodedVaa {
    fn from(vaa: &str) -> Self {
        let mut buf = base64::prelude::BASE64_STANDARD.decode(vaa).unwrap();
        let guardian_set_index = u32::from_be_bytes(buf[1..5].try_into().unwrap());
        let total_signatures = buf[5];

        let body = buf
            .drain((6 + total_signatures as usize * wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH)..)
            .collect();

        let mut guardian_signatures = Vec::with_capacity(total_signatures as usize);

        for i in 0..usize::from(total_signatures) {
            let offset = 6 + i * 66;
            let mut signature = [0; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH];
            signature.copy_from_slice(&buf[offset..offset + wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]);
            guardian_signatures.push(signature);
        }

        Self {
            guardian_set_index,
            total_signatures,
            guardian_signatures,
            body,
        }
    }
}

#[allow(dead_code)]
fn set_up_verify_shims_transaction(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, guardian_signatures_signer: &Rc<Keypair>) -> (VersionedTransaction, DecodedVaa) {
    const VAA: &str = "AQAAAAQNAL1qji7v9KnngyX0VxK+3fCMVscWTLoYX8L48NWquq2WGrcHd4H0wYc0KF4ZOWjLD2okXoBjGQIDJzx4qIrbSzQBAQq69h+neXGb58VfhZgraPVCxJmnTj8JIDq5jqi3Qav1e+IW51mIJlOhSAdCRbEyQLzf6Z3C19WJJqSyt/z1XF0AAvFgDHkseyMZTE5vQjflu4tc5OLPJe2VYCxTJT15LA02YPrWgOM6HhfUhXDhFoG5AI/s2ApjK8jaqi7LGJILAUMBA6cp4vfko8hYyRvogqQWsdk9e20g0O6s60h4ewweapXCQHerQpoJYdDxlCehN4fuYnuudEhW+6FaXLjwNJBdqsoABDg9qXjXB47nBVCZAGns2eosVqpjkyDaCfo/p1x8AEjBA80CyC1/QlbG9L4zlnnDIfZWylsf3keJqx28+fZNC5oABi6XegfozgE8JKqvZLvd7apDhrJ6Qv+fMiynaXASkafeVJOqgFOFbCMXdMKehD38JXvz3JrlnZ92E+I5xOJaDVgABzDSte4mxUMBMJB9UUgJBeAVsokFvK4DOfvh6G3CVqqDJplLwmjUqFB7fAgRfGcA8PWNStRc+YDZiG66YxPnptwACe84S31Kh9voz2xRk1THMpqHQ4fqE7DizXPNWz6Z6ebEXGcd7UP9PBXoNNvjkLWZJZOdbkZyZqztaIiAo4dgWUABCobiuQP92WjTxOZz0KhfWVJ3YBVfsXUwaVQH4/p6khX0HCEVHR9VHmjvrAAGDMdJGWW+zu8mFQc4gPU6m4PZ6swADO7voA5GWZZPiztz22pftwxKINGvOjCPlLpM1Y2+Vq6AQuez/mlUAmaL0NKgs+5VYcM1SGBz0TL3ABRhKQAhUEMADWmiMo0J1Qaj8gElb+9711ZjvAY663GIyG/E6EdPW+nPKJI9iZE180sLct+krHj0J7PlC9BjDiO2y149oCOJ6FgAEcaVkYK43EpN7XqxrdpanX6R6TaqECgZTjvtN3L6AP2ceQr8mJJraYq+qY8pTfFvPKEqmW9CBYvnA5gIMpX59WsAEjIL9Hdnx+zFY0qSPB1hB9AhqWeBP/QfJjqzqafsczaeCN/rWUf6iNBgXI050ywtEp8JQ36rCn8w6dRhUusn+MEAZ32XyAAAAAAAFczO6yk0j3G90i/+9DoqGcH1teF8XMpUEVKRIBgmcq3lAAAAAAAC/1wAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC6Q7dAAAAAAAAAAAAAAAAAAoLhpkcYhizbB0Z1KLp6wzjYG60gAAgAAAAAAAAAAAAAAAInNTEvk5b/1WVF+JawF1smtAdicABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
    let decoded_vaa = DecodedVaa::from(VAA);
    let decoded_vaa_clone = decoded_vaa.clone();
    assert_eq!(decoded_vaa.total_signatures, 13);
    let recent_blockhash = test_ctx.borrow().last_blockhash;
    let guardian_signatures_vec: &Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]> = &decoded_vaa.guardian_signatures;
    (post_signatures_transaction(payer_signer, guardian_signatures_signer, decoded_vaa.guardian_set_index, decoded_vaa.total_signatures, guardian_signatures_vec, recent_blockhash), decoded_vaa_clone)
}

fn post_signatures_transaction(payer_signer: &Rc<Keypair>, guardian_signatures_signer: &Rc<Keypair>, guardian_set_index: u32, total_signatures: u8, guardian_signatures_vec: &Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]>, recent_blockhash: Hash) -> VersionedTransaction {
    let post_signatures_ix = verify_vaa::PostSignatures {
        program_id: &WORMHOLE_VERIFY_VAA_SHIM_PID,
        accounts: verify_vaa::PostSignaturesAccounts {
            payer: &payer_signer.pubkey(),
            guardian_signatures: &guardian_signatures_signer.pubkey(),
        },
        data: verify_vaa::PostSignaturesData::new(
            guardian_set_index,
            total_signatures,
            guardian_signatures_vec.as_slice(),
        ),
    }
    .instruction();

    let message = Message::try_compile(
        &payer_signer.pubkey(),
        &[
            post_signatures_ix,
            ComputeBudgetInstruction::set_compute_unit_price(69),
            // NOTE: CU limit is higher than needed to resolve errors in test.
            ComputeBudgetInstruction::set_compute_unit_limit(25_000),
        ],
        &[],
        recent_blockhash,
    )
    .unwrap();

    VersionedTransaction::try_new(
        VersionedMessage::V0(message),
        &[payer_signer, guardian_signatures_signer],
    )
    .unwrap()
}

#[allow(dead_code)]
fn generate_expected_guardian_signatures_info(
    payer: &Pubkey,
    total_signatures: u8,
    guardian_set_index: u32,
    guardian_signatures: Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]>,
) -> (
    usize, // expected length
    GuardianSignatures,
) {
    let expected_length = {
        8 // discriminator
        + 32 // refund recipient
        + 4 // guardian set index
        + 4 // guardian signatures length
        + (total_signatures as usize) * wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH
    };

    let guardian_signatures = GuardianSignatures {
        refund_recipient: *payer,
        guardian_set_index_be: guardian_set_index.to_be_bytes(),
        guardian_signatures,
    };

    (expected_length, guardian_signatures)
}

pub struct PlaceInitialOfferShimFixture {
    pub auction_address: Pubkey,
    pub auction_custody_token_address: Pubkey,
    pub guardian_set_pubkey: Pubkey,
    pub guardian_signatures_pubkey: Pubkey,
    pub fast_market_order_address: Pubkey,
    pub fast_market_order: FastMarketOrderState,
}

/// Places an initial offer using the fallback program. The vaa is constructed from a passed in PostedVaaData struct. The nonce is forced to 0. 
pub async fn place_initial_offer_fallback(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, program_id: &Pubkey, wormhole_program_id: &Pubkey, vaa_data: &super::vaa::PostedVaaData, solver: Solver, auction_accounts: &super::auction::AuctionAccounts, offer_price: u64) -> Result<PlaceInitialOfferShimFixture> {
    let (fast_market_order, vaa_data) = create_fast_market_order_state_from_vaa_data(vaa_data, solver.pubkey());

    let auction_address = Pubkey::find_program_address(&[Auction::SEED_PREFIX, &fast_market_order.digest], &program_id).0;
    let auction_custody_token_address = Pubkey::find_program_address(&[matching_engine::AUCTION_CUSTODY_TOKEN_SEED_PREFIX, auction_address.as_ref()], &program_id).0;
    
    // Approve the transfer authority
    let transfer_authority = Pubkey::find_program_address(&[common::TRANSFER_AUTHORITY_SEED_PREFIX, &auction_address.to_bytes(), &offer_price.to_be_bytes()], &program_id).0;
    {
        solver.approve_usdc(test_ctx, &transfer_authority, 420_000__000_000).await;
    }
    let solver_usdc_balance = solver.get_balance(test_ctx).await;
    println!("Solver USDC balance: {:?}", solver_usdc_balance);

    // Create the guardian set and signatures
    let (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump) = create_guardian_signatures(test_ctx, payer_signer, &vaa_data, wormhole_program_id, Some(&solver.keypair())).await;
    
    // Create the fast market order account
    let fast_market_order_account = Pubkey::find_program_address(&[FastMarketOrderState::SEED_PREFIX, &fast_market_order.digest, &fast_market_order.refund_recipient], program_id).0;

    let create_fast_market_order_ix = initialise_fast_market_order_fallback_instruction(payer_signer, program_id, fast_market_order, guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump);

    let place_initial_offer_ix_data = PlaceInitialOfferCctpShimFallbackData::new(offer_price, vaa_data.sequence, vaa_data.vaa_time,  vaa_data.consistency_level);

    let place_initial_offer_ix_accounts = PlaceInitialOfferCctpShimFallbackAccounts {
        signer: &payer_signer.pubkey(),
        transfer_authority: &transfer_authority,
        custodian: &auction_accounts.custodian,
        auction_config: &auction_accounts.auction_config,
        from_endpoint: &auction_accounts.from_router_endpoint,
        to_endpoint: &auction_accounts.to_router_endpoint,
        fast_market_order: &fast_market_order_account,
        auction: &auction_address,
        offer_token: &auction_accounts.offer_token,
        auction_custody_token: &auction_custody_token_address,
        usdc: &auction_accounts.usdc_mint,
        system_program: &solana_program::system_program::ID,
        token_program: &anchor_spl::token::spl_token::ID,
    };
    let place_initial_offer_ix = PlaceInitialOfferCctpShimFallback {
        program_id: program_id,
        accounts: place_initial_offer_ix_accounts,
        data: place_initial_offer_ix_data,
    }.instruction();

    let recent_blockhash = test_ctx.borrow().last_blockhash;

    let transaction = Transaction::new_signed_with_payer(&[create_fast_market_order_ix, place_initial_offer_ix], Some(&payer_signer.pubkey()), &[&payer_signer], recent_blockhash);
    
    test_ctx.borrow_mut().banks_client.process_transaction(transaction).await.expect("Failed to place initial offer");
    

    Ok(PlaceInitialOfferShimFixture {
        auction_address,
        auction_custody_token_address,
        guardian_set_pubkey,
        guardian_signatures_pubkey: guardian_signatures_pubkey.clone().to_owned(),
        fast_market_order_address: fast_market_order_account,
        fast_market_order,
    })
}

pub fn initialise_fast_market_order_fallback_instruction(payer_signer: &Rc<Keypair>, program_id: &Pubkey, fast_market_order: FastMarketOrderState, guardian_set_pubkey: Pubkey, guardian_signatures_pubkey: Pubkey, guardian_set_bump: u8) -> solana_program::instruction::Instruction {
    let fast_market_order_account = Pubkey::find_program_address(&[FastMarketOrderState::SEED_PREFIX, &fast_market_order.digest, &fast_market_order.refund_recipient], program_id).0;
    
    let create_fast_market_order_accounts = InitialiseFastMarketOrderFallbackAccounts {
        signer: &payer_signer.pubkey(),
        fast_market_order_account: &fast_market_order_account,
        guardian_set: &guardian_set_pubkey,
        guardian_set_signatures: &guardian_signatures_pubkey,
        verify_vaa_shim_program: &WORMHOLE_VERIFY_VAA_SHIM_PID,
        system_program: &solana_program::system_program::ID,
    };

    InitialiseFastMarketOrderFallback {
        program_id: program_id,
        accounts: create_fast_market_order_accounts,
        data: InitialiseFastMarketOrderFallbackData::new(fast_market_order, guardian_set_bump),
    }.instruction()
}

pub fn create_fast_market_order_state_from_vaa_data(vaa_data: &super::vaa::PostedVaaData, refund_recipient: Pubkey) -> (FastMarketOrderState, super::vaa::PostedVaaData) {
    let vaa_data = super::vaa::PostedVaaData {
        consistency_level: vaa_data.consistency_level,
        vaa_time: vaa_data.vaa_time,
        sequence: vaa_data.sequence,
        emitter_chain: vaa_data.emitter_chain,
        emitter_address: vaa_data.emitter_address,
        payload: vaa_data.payload.clone(),
        nonce: 0,
        vaa_signature_account: vaa_data.vaa_signature_account,
        submission_time: 0,
    };
    let vaa_message = matching_engine::fallback::place_initial_offer::VaaMessageBodyHeader::new(
        vaa_data.consistency_level,
        vaa_data.vaa_time,
        vaa_data.sequence,
        vaa_data.emitter_chain,
        vaa_data.emitter_address,
    );

    let order: FastMarketOrder = TypePrefixedPayload::<1>::read_slice(&vaa_data.payload).unwrap();
    
    let redeemer_message_fixed_length = {
        let mut fixed_array = [0u8; 512]; // Initialize with zeros (automatic padding)
        
        if !order.redeemer_message.is_empty() {
            // Calculate how many bytes to copy (min of message length and array size)
            let copy_len = std::cmp::min(order.redeemer_message.len(), 512);
            
            // Copy the bytes from the message to the fixed array
            fixed_array[..copy_len].copy_from_slice(&order.redeemer_message[..copy_len]);
        }
        
        fixed_array
    };
    let fast_market_order = FastMarketOrderState::new(
        order.amount_in,
        order.min_amount_out,
        order.deadline,
        order.target_chain,
        order.redeemer_message.len() as u16,
        order.redeemer,
        order.sender,
        order.refund_address,
        order.max_fee,
        order.init_auction_fee,
        redeemer_message_fixed_length,
        vaa_data.digest(),
        refund_recipient.to_bytes(),
        vaa_data.sequence,
        vaa_data.vaa_time,
        vaa_data.emitter_chain,
        vaa_data.emitter_address,
    );

    assert_eq!(fast_market_order.redeemer, order.redeemer);
    assert_eq!(vaa_message.digest(&fast_market_order).as_ref(), vaa_data.digest().as_ref());

    (fast_market_order, vaa_data)
}

pub async fn create_guardian_signatures(test_ctx: &Rc<RefCell<ProgramTestContext>>, payer_signer: &Rc<Keypair>, vaa_data: &super::vaa::PostedVaaData, wormhole_program_id: &Pubkey, guardian_signature_signer: Option<&Rc<Keypair>>) -> (Pubkey, Pubkey, u8) {
    let new_keypair = Rc::new(Keypair::new());
    let guardian_signature_signer = guardian_signature_signer.unwrap_or(&new_keypair);
    let (guardian_set_pubkey, guardian_set_bump) = wormhole_svm_definitions::find_guardian_set_address(0_u32.to_be_bytes(), &wormhole_program_id);
    let guardian_secret_key = secp256k1::SecretKey::from_str(GUARDIAN_SECRET_KEY).expect("Failed to parse guardian secret key");
    let guardian_set_signatures = vaa_data.sign_with_guardian_key(&guardian_secret_key, 0);
    let guardian_signatures_pubkey = add_guardian_signatures_account(test_ctx, payer_signer, guardian_signature_signer, vec![guardian_set_signatures], 0).await.expect("Failed to post guardian signatures");
    (guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump)
}
