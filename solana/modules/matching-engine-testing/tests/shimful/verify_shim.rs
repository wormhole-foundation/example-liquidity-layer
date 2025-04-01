use crate::testing_engine::setup::TestingContext;
use crate::utils;
use crate::utils::constants::*;
use anchor_lang::prelude::*;
use anyhow::Result as AnyhowResult;

use solana_program_test::ProgramTestContext;
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    hash::Hash,
    message::{v0::Message, VersionedMessage},
    signature::{Keypair, Signer},
    transaction::VersionedTransaction,
};

use std::rc::Rc;
use std::str::FromStr;
use wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH;
use wormhole_svm_shim::verify_vaa;

pub struct GuardianSignatureInfo {
    pub guardian_set_pubkey: Pubkey,
    pub guardian_signatures_pubkey: Pubkey,
    pub guardian_set_bump: u8,
}

/// Create guardian signatures for a given vaa data
///
/// This also creates the account holding the signatures and posts the signatures to the guardian signatures account
///
/// # Arguments
///
/// * `test_ctx` - The test context
/// * `payer_signer` - The payer signer
/// * `vaa_data` - The vaa data
/// * `wormhole_program_id` - The wormhole program id
/// * `guardian_signature_signer` - The guardian signature signer keypair. If None, a new keypair is created.
///
/// # Returns
///
/// * `(guardian_set_pubkey, guardian_signatures_pubkey, guardian_set_bump)` - The guardian set pubkey, the guardian signatures pubkey and the guardian set bump
pub async fn create_guardian_signatures(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    payer_signer: &Rc<Keypair>,
    vaa_data: &utils::vaa::PostedVaaData,
    wormhole_program_id: &Pubkey,
    guardian_signature_signer: Option<&Rc<Keypair>>,
) -> AnyhowResult<GuardianSignatureInfo> {
    let new_keypair = Rc::new(Keypair::new());
    let guardian_signature_signer = guardian_signature_signer.unwrap_or_else(|| &new_keypair);
    let (guardian_set_pubkey, guardian_set_bump) =
        wormhole_svm_definitions::find_guardian_set_address(
            0_u32.to_be_bytes(),
            wormhole_program_id,
        );
    let guardian_secret_key = secp256k1::SecretKey::from_str(GUARDIAN_SECRET_KEY)?;
    let guardian_set_signatures = vaa_data.sign_with_guardian_key(&guardian_secret_key, 0);
    let guardian_signatures_pubkey = add_guardian_signatures_account(
        testing_context,
        test_context,
        payer_signer,
        guardian_signature_signer,
        vec![guardian_set_signatures],
        0,
    )
    .await?;
    Ok(GuardianSignatureInfo {
        guardian_set_pubkey,
        guardian_signatures_pubkey,
        guardian_set_bump,
    })
}

/// Add a guardian signatures account
///
/// This creates a new guardian signatures account and posts the signatures to it
///
/// # Arguments
///
/// * `test_ctx` - The test context
/// * `payer_signer` - The payer signer
/// * `signatures_signer` - The signatures signer keypair. If None, a new keypair is created.
/// * `guardian_signatures` - The guardian signatures
/// * `guardian_set_index` - The guardian set index
///
/// # Returns
///
/// * `guardian_signatures_pubkey` - The guardian signatures pubkey
async fn add_guardian_signatures_account(
    testing_context: &TestingContext,
    test_context: &mut ProgramTestContext,
    payer_signer: &Rc<Keypair>,
    signatures_signer: &Rc<Keypair>,
    guardian_signatures: Vec<[u8; GUARDIAN_SIGNATURE_LENGTH]>,
    guardian_set_index: u32,
) -> AnyhowResult<Pubkey> {
    let new_blockhash = testing_context
        .get_new_latest_blockhash(test_context)
        .await?;
    let transaction = post_signatures_transaction(
        payer_signer,
        signatures_signer,
        guardian_set_index,
        u8::try_from(guardian_signatures.len())?,
        &guardian_signatures,
        new_blockhash,
    );
    testing_context
        .process_transaction(test_context, transaction)
        .await?;

    Ok(signatures_signer.pubkey())
}

/// Post signatures transaction
///
/// Creates the transaction to post the signatures to the guardian signatures account
///
/// # Arguments
///
/// * `payer_signer` - The payer signer
/// * `guardian_signatures_signer` - The guardian signatures signer
/// * `guardian_set_index` - The guardian set index
/// * `total_signatures` - The total signatures
/// * `guardian_signatures_vec` - The guardian signatures
/// * `recent_blockhash` - The recent blockhash
///
/// # Returns
///
/// * `VersionedTransaction` - The versioned transaction that can be executed to post the signatures
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
