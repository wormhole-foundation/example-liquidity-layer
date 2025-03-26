use crate::utils;
use crate::utils::constants::*;
use anchor_lang::prelude::*;
use base64::Engine;
use solana_program_test::ProgramTestContext;
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    hash::Hash,
    message::{v0::Message, VersionedMessage},
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};
use std::cell::RefCell;
use std::rc::Rc;
use std::str::FromStr;
use wormhole_svm_definitions::borsh::GuardianSignatures;
use wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH;
use wormhole_svm_shim::verify_vaa;

pub async fn create_guardian_signatures(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    vaa_data: &utils::vaa::PostedVaaData,
    wormhole_program_id: &Pubkey,
    guardian_signature_signer: Option<&Rc<Keypair>>,
) -> (Pubkey, Pubkey, u8) {
    let new_keypair = Rc::new(Keypair::new());
    let guardian_signature_signer = guardian_signature_signer.unwrap_or(&new_keypair);
    let (guardian_set_pubkey, guardian_set_bump) =
        wormhole_svm_definitions::find_guardian_set_address(
            0_u32.to_be_bytes(),
            &wormhole_program_id,
        );
    let guardian_secret_key = secp256k1::SecretKey::from_str(GUARDIAN_SECRET_KEY)
        .expect("Failed to parse guardian secret key");
    let guardian_set_signatures = vaa_data.sign_with_guardian_key(&guardian_secret_key, 0);
    let guardian_signatures_pubkey = add_guardian_signatures_account(
        test_ctx,
        payer_signer,
        guardian_signature_signer,
        vec![guardian_set_signatures],
        0,
    )
    .await
    .expect("Failed to post guardian signatures");
    (
        guardian_set_pubkey,
        guardian_signatures_pubkey,
        guardian_set_bump,
    )
}

pub async fn add_guardian_signatures_account(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    signatures_signer: &Rc<Keypair>,
    guardian_signatures: Vec<[u8; GUARDIAN_SIGNATURE_LENGTH]>,
    guardian_set_index: u32,
) -> Result<Pubkey> {
    let new_blockhash = test_ctx
        .borrow_mut()
        .get_new_latest_blockhash()
        .await
        .expect("Failed to get new blockhash");
    let transaction = post_signatures_transaction(
        payer_signer,
        signatures_signer,
        guardian_set_index,
        guardian_signatures.len() as u8,
        &guardian_signatures,
        new_blockhash,
    );
    test_ctx
        .borrow_mut()
        .banks_client
        .process_transaction(transaction)
        .await
        .expect("Failed to add guardian signatures account");

    Ok(signatures_signer.pubkey())
}

fn post_signatures_transaction(
    payer_signer: &Rc<Keypair>,
    guardian_signatures_signer: &Rc<Keypair>,
    guardian_set_index: u32,
    total_signatures: u8,
    guardian_signatures_vec: &Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]>,
    recent_blockhash: Hash,
) -> VersionedTransaction {
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
/// Post signatures before the auction is created.
pub async fn set_up_verify_shims_test(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
) -> Result<Pubkey> {
    let guardian_signatures_signer = Rc::new(Keypair::new());
    let (transaction, decoded_vaa) =
        set_up_verify_shims_transaction(test_ctx, payer_signer, &guardian_signatures_signer);

    let _details = {
        let out = test_ctx
            .borrow_mut()
            .banks_client
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
        let out = test_ctx
            .borrow_mut()
            .banks_client
            .process_transaction(transaction)
            .await;
        assert!(out.is_ok());
        out.unwrap();
    };

    // Check guardian signatures account after processing the transaction.
    let guardian_signatures_info = test_ctx
        .borrow_mut()
        .banks_client
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
        wormhole_svm_definitions::borsh::deserialize_with_discriminator::<
            wormhole_svm_definitions::borsh::GuardianSignatures,
        >(&account_data[..])
        .unwrap(),
        expected_guardian_signatures_data
    );
    Ok(guardian_signatures_signer.pubkey())
}

#[allow(dead_code)]
fn set_up_verify_shims_transaction(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    payer_signer: &Rc<Keypair>,
    guardian_signatures_signer: &Rc<Keypair>,
) -> (VersionedTransaction, DecodedVaa) {
    const VAA: &str = "AQAAAAQNAL1qji7v9KnngyX0VxK+3fCMVscWTLoYX8L48NWquq2WGrcHd4H0wYc0KF4ZOWjLD2okXoBjGQIDJzx4qIrbSzQBAQq69h+neXGb58VfhZgraPVCxJmnTj8JIDq5jqi3Qav1e+IW51mIJlOhSAdCRbEyQLzf6Z3C19WJJqSyt/z1XF0AAvFgDHkseyMZTE5vQjflu4tc5OLPJe2VYCxTJT15LA02YPrWgOM6HhfUhXDhFoG5AI/s2ApjK8jaqi7LGJILAUMBA6cp4vfko8hYyRvogqQWsdk9e20g0O6s60h4ewweapXCQHerQpoJYdDxlCehN4fuYnuudEhW+6FaXLjwNJBdqsoABDg9qXjXB47nBVCZAGns2eosVqpjkyDaCfo/p1x8AEjBA80CyC1/QlbG9L4zlnnDIfZWylsf3keJqx28+fZNC5oABi6XegfozgE8JKqvZLvd7apDhrJ6Qv+fMiynaXASkafeVJOqgFOFbCMXdMKehD38JXvz3JrlnZ92E+I5xOJaDVgABzDSte4mxUMBMJB9UUgJBeAVsokFvK4DOfvh6G3CVqqDJplLwmjUqFB7fAgRfGcA8PWNStRc+YDZiG66YxPnptwACe84S31Kh9voz2xRk1THMpqHQ4fqE7DizXPNWz6Z6ebEXGcd7UP9PBXoNNvjkLWZJZOdbkZyZqztaIiAo4dgWUABCobiuQP92WjTxOZz0KhfWVJ3YBVfsXUwaVQH4/p6khX0HCEVHR9VHmjvrAAGDMdJGWW+zu8mFQc4gPU6m4PZ6swADO7voA5GWZZPiztz22pftwxKINGvOjCPlLpM1Y2+Vq6AQuez/mlUAmaL0NKgs+5VYcM1SGBz0TL3ABRhKQAhUEMADWmiMo0J1Qaj8gElb+9711ZjvAY663GIyG/E6EdPW+nPKJI9iZE180sLct+krHj0J7PlC9BjDiO2y149oCOJ6FgAEcaVkYK43EpN7XqxrdpanX6R6TaqECgZTjvtN3L6AP2ceQr8mJJraYq+qY8pTfFvPKEqmW9CBYvnA5gIMpX59WsAEjIL9Hdnx+zFY0qSPB1hB9AhqWeBP/QfJjqzqafsczaeCN/rWUf6iNBgXI050ywtEp8JQ36rCn8w6dRhUusn+MEAZ32XyAAAAAAAFczO6yk0j3G90i/+9DoqGcH1teF8XMpUEVKRIBgmcq3lAAAAAAAC/1wAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC6Q7dAAAAAAAAAAAAAAAAAAoLhpkcYhizbB0Z1KLp6wzjYG60gAAgAAAAAAAAAAAAAAAInNTEvk5b/1WVF+JawF1smtAdicABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
    let decoded_vaa = DecodedVaa::from(VAA);
    let decoded_vaa_clone = decoded_vaa.clone();
    assert_eq!(decoded_vaa.total_signatures, 13);
    let recent_blockhash = test_ctx.borrow().last_blockhash;
    let guardian_signatures_vec: &Vec<[u8; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH]> =
        &decoded_vaa.guardian_signatures;
    (
        post_signatures_transaction(
            payer_signer,
            guardian_signatures_signer,
            decoded_vaa.guardian_set_index,
            decoded_vaa.total_signatures,
            guardian_signatures_vec,
            recent_blockhash,
        ),
        decoded_vaa_clone,
    )
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
            .drain(
                (6 + total_signatures as usize
                    * wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH)..,
            )
            .collect();

        let mut guardian_signatures = Vec::with_capacity(total_signatures as usize);

        for i in 0..usize::from(total_signatures) {
            let offset = 6 + i * 66;
            let mut signature = [0; wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH];
            signature.copy_from_slice(
                &buf[offset..offset + wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH],
            );
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
