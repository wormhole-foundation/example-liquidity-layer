use anchor_lang::prelude::*;
use common::messages::wormhole_io::{TypePrefixedPayload, WriteableBytes};
use common::messages::{FastMarketOrder, SlowOrderResponse};
use common::wormhole_cctp_solana::messages::Deposit; // Implements to_vec() under PrefixedPayload
use secp256k1::SecretKey as SecpSecretKey;
use wormhole_svm_definitions::GUARDIAN_SIGNATURE_LENGTH;

use super::constants::Chain;

use super::constants::CORE_BRIDGE_PID;
use super::public_keys::{ChainAddress, ToBytes};
use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};
use solana_program::keccak;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::account::Account;

use std::ops::{Deref, DerefMut};

pub trait DataDiscriminator {
    const DISCRIMINATOR: &'static [u8];
}

/// A struct representing a posted VAA
///
/// # Fields
///
/// * `consistency_level` - The level of consistency requested by the emitter
/// * `vaa_time` - The time the VAA was submitted
/// * `vaa_signature_account` - The account where signatures are stored
/// * `submission_time` - The time the posted message was created
/// * `nonce` - The unique nonce for this message
/// * `sequence` - The sequence number of this message
/// * `emitter_chain` - The chain ID of the emitter
/// * `emitter_address` - The address of the emitter
/// * `payload` - The payload of the VAA
#[derive(
    Debug, Default, BorshSerialize, BorshDeserialize, Clone, Serialize, Deserialize, PartialEq, Eq,
)]
pub struct PostedVaaData {
    /// Header of the posted VAA
    // pub vaa_version: u8, (This is removed because it is encoded in the discriminator)
    pub consistency_level: u8,

    pub vaa_time: u32,

    pub vaa_signature_account: Pubkey,

    pub submission_time: u32,

    pub nonce: u32,

    pub sequence: u64,

    pub emitter_chain: u16,

    pub emitter_address: [u8; 32],

    pub payload: Vec<u8>,
}

impl DataDiscriminator for PostedVaaData {
    const DISCRIMINATOR: &'static [u8] = b"vaa\x01";
}

impl PostedVaaData {
    /// Creates a new posted VAA
    ///
    /// # Arguments
    ///
    /// * `chain` - The chain the VAA is being posted to
    /// * `payload` - The payload of the VAA
    /// * `emitter_address` - The address of the emitter
    /// * `sequence` - The sequence number of the VAA
    /// * `nonce` - The nonce of the VAA
    pub fn new(
        chain: Chain,
        payload: Vec<u8>,
        emitter_address: impl ToBytes,
        sequence: u64,
        nonce: u32,
    ) -> Self {
        let timestamp = u32::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        )
        .unwrap();
        let emitter_chain = chain.as_chain_id();
        Self {
            consistency_level: 1,
            vaa_time: timestamp,
            vaa_signature_account: Pubkey::new_unique(),
            submission_time: 0,
            nonce,
            sequence,
            emitter_chain,
            emitter_address: emitter_address.to_bytes(),
            payload: payload.to_vec(),
        }
    }

    /// Computes the hash of the VAA (needed for the digest of the VAA)
    pub fn message_hash(&self) -> keccak::Hash {
        keccak::hashv(&[
            self.vaa_time.to_be_bytes().as_ref(),
            self.nonce.to_be_bytes().as_ref(),
            self.emitter_chain.to_be_bytes().as_ref(),
            &self.emitter_address,
            &self.sequence.to_be_bytes(),
            &[self.consistency_level],
            self.payload.as_ref(),
        ])
    }

    /// Signs the VAA with the guardian key
    ///
    /// # Arguments
    ///
    /// * `guardian_secret_key` - The guardian key
    /// * `index` - The index of the guardian
    ///
    /// # Returns
    ///
    /// The 66 byte signature (with recovery id at final index and guardian index at first index)
    pub fn sign_with_guardian_key(
        &self,
        guardian_secret_key: &SecpSecretKey,
        index: u8,
    ) -> [u8; 66] {
        // Sign the message hash with the guardian key
        let secp = secp256k1::SECP256K1;
        let msg = secp256k1::Message::from_digest(self.digest());
        let recoverable_signature = secp.sign_ecdsa_recoverable(&msg, guardian_secret_key);
        let mut signature_bytes = [0u8; GUARDIAN_SIGNATURE_LENGTH];
        // First byte is the index
        signature_bytes[0] = index;
        // Next 64 bytes are the signature in compact format
        let (recovery_id, compact_sig) = recoverable_signature.serialize_compact();
        // Recovery ID goes in byte 65
        signature_bytes[1..65].copy_from_slice(&compact_sig);
        signature_bytes[65] = u8::try_from(i32::from(recovery_id)).unwrap();
        signature_bytes
    }

    /// Computes the digest of the VAA
    ///
    /// # Returns
    ///
    /// The 32 byte digest of the VAA
    pub fn digest(&self) -> [u8; 32] {
        keccak::hashv(&[self.message_hash().as_ref()])
            .as_ref()
            .try_into()
            .unwrap()
    }

    /// Creates a VAA account
    ///
    /// # Arguments
    ///
    /// * `program_test` - The program test
    /// * `vaa_address` - The address of the VAA
    pub fn create_vaa_account(&self, program_test: &mut ProgramTest, vaa_address: Pubkey) {
        let vaa_data_serialized = serialize_with_discriminator(self).unwrap();
        let lamports = solana_sdk::rent::Rent::default().minimum_balance(vaa_data_serialized.len());
        let vaa_account = Account {
            lamports,
            data: vaa_data_serialized,
            owner: CORE_BRIDGE_PID,
            executable: false,
            rent_epoch: u64::MAX,
        };
        program_test.add_account(vaa_address, vaa_account);
    }
}

pub fn deserialize_with_discriminator<T: BorshDeserialize + DataDiscriminator>(
    data: &[u8],
) -> Option<T> {
    let mut discriminant = [0u8; 4];
    discriminant.copy_from_slice(&data[..4]);
    if discriminant != T::DISCRIMINATOR {
        return None;
    }
    let data = data[4..].to_vec();
    let message = T::try_from_slice(&data);
    match message {
        Ok(message) => Some(message),
        Err(_) => None,
    }
}

pub fn serialize_with_discriminator<T>(message: &T) -> Result<Vec<u8>>
where
    T: BorshSerialize + DataDiscriminator,
{
    let mut data = Vec::new();
    data.extend_from_slice(T::DISCRIMINATOR);
    message.serialize(&mut data)?;
    Ok(data)
}

/// A struct representing the deserialized payload of a VAA
///
/// # Enums
///
/// * `deposit` - The deposit payload
/// * `fast_transfer` - The fast transfer payload
#[derive(Clone)]
pub enum PayloadDeserialized {
    Deposit(Deposit),
    FastTransfer(FastMarketOrder),
}

impl PayloadDeserialized {
    pub fn get_deposit(&self) -> Option<Deposit> {
        match self {
            Self::Deposit(deposit) => Some(deposit.clone()),
            _ => None,
        }
    }

    // pub fn get_fast_transfer(&self) -> Option<FastMarketOrder> {
    //     match self {
    //         Self::FastTransfer(fast_transfer) => Some(fast_transfer.clone()),
    //         _ => None,
    //     }
    // }
}

/// A struct representing a test VAA (may be posted or not)
///
/// # Fields
///
/// * `kind` - The kind of VAA
/// * `vaa_pubkey` - The pubkey of the VAA
/// * `vaa_data` - The data of the VAA
/// * `payload_deserialized` - The deserialized payload of the VAA
/// * `is_posted` - Whether the VAA has been posted
#[derive(Clone)]
pub struct TestVaa {
    pub kind: TestVaaKind,
    pub vaa_pubkey: Pubkey,
    pub vaa_data: PostedVaaData,
    pub payload_deserialized: Option<PayloadDeserialized>,
    pub is_posted: bool,
}

impl TestVaa {
    /// Gets the pubkey of the VAA
    pub fn get_vaa_pubkey(&self) -> Pubkey {
        self.vaa_pubkey
    }

    /// Gets the posted vaa data of the VAA
    pub fn get_vaa_data(&self) -> &PostedVaaData {
        &self.vaa_data
    }
}

#[derive(Clone)]
pub enum TestVaaKind {
    Deposit,
    FastTransfer,
}

/// A struct representing the parameters for creating a deposit and fast transfer
#[derive(Default)]
pub struct CreateDepositAndFastTransferParams {
    pub deposit_params: CreateDepositParams,
    pub fast_transfer_params: CreateFastTransferParams,
}

impl CreateDepositAndFastTransferParams {
    /// Verifies the parameters for creating a deposit and fast transfer
    pub fn verify(&self) {
        assert!(
            self.fast_transfer_params.max_fee
                > self
                    .deposit_params
                    .base_fee
                    .saturating_add(self.fast_transfer_params.init_auction_fee),
            "Max fee must be greater than the sum of the base fee and the init auction fee"
        );
        assert!(
            self.fast_transfer_params.amount_in > self.fast_transfer_params.max_fee,
            "Amount in must be greater than max fee"
        );
    }
}

pub struct CreateDepositParams {
    pub amount: i32,
    pub base_fee: u64,
}

impl Default for CreateDepositParams {
    fn default() -> Self {
        Self {
            amount: 69000000,
            base_fee: 2,
        }
    }
}

pub struct CreateFastTransferParams {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub max_fee: u64,
    pub init_auction_fee: u64,
}

impl Default for CreateFastTransferParams {
    fn default() -> Self {
        Self {
            amount_in: 69000000,
            min_amount_out: 69000000,
            max_fee: 6000000,
            init_auction_fee: 10,
        }
    }
}

/// Helper struct for creating test VAA arguments
pub struct TestVaaArgs {
    pub start_timestamp: Option<u32>,
    pub sequence: u64,
    pub cctp_nonce: u64,
    pub vaa_nonce: u32,
    pub is_posted: bool,
}

impl From<VaaArgs> for TestVaaArgs {
    fn from(vaa_args: VaaArgs) -> Self {
        Self {
            start_timestamp: vaa_args.start_timestamp,
            sequence: vaa_args.sequence.unwrap_or_default(),
            cctp_nonce: vaa_args.cctp_nonce.unwrap_or_default(),
            vaa_nonce: vaa_args.vaa_nonce.unwrap_or_default(),
            is_posted: vaa_args.post_vaa,
        }
    }
}

/// A struct representing a pair of test VAA
///
/// # Fields
///
/// * `token_mint` - The mint of the token
/// * `source_address` - The source address
/// * `refund_address` - The refund address
/// * `destination_address` - The destination address
/// * `cctp_nonce` - The CCTP nonce
/// * `sequence` - The sequence number
/// * `fast_transfer_vaa` - The fast transfer VAA
/// * `deposit_vaa` - The deposit VAA
#[derive(Clone)]
pub struct TestVaaPair {
    pub token_mint: Pubkey,
    pub source_address: ChainAddress,
    pub refund_address: ChainAddress,
    pub destination_address: ChainAddress,
    pub cctp_nonce: u32,
    pub sequence: u64,
    pub fast_transfer_vaa: TestVaa, // kind: TestVaaKind::FastTransfer
    pub deposit_vaa: TestVaa,       // kind: TestVaaKind::Deposit
}

impl TestVaaPair {
    /// Creates a new test VAA pair
    ///
    /// # Arguments
    ///
    /// * `token_mint` - The mint of the token
    /// * `source_address` - The source address
    /// * `refund_address` - The refund address
    /// * `destination_address` - The destination address
    /// * `cctp_mint_recipient` - The CCTP mint recipient
    /// * `create_deposit_and_fast_transfer_params` - The parameters for creating a deposit and fast transfer
    /// * `test_vaa_args` - The arguments for the test VAA
    pub fn new(
        token_mint: Pubkey,
        source_address: ChainAddress,
        refund_address: ChainAddress,
        destination_address: ChainAddress,
        cctp_mint_recipient: Pubkey,
        create_deposit_and_fast_transfer_params: &CreateDepositAndFastTransferParams,
        test_vaa_args: &TestVaaArgs,
    ) -> Self {
        create_deposit_and_fast_transfer_params.verify();
        let deposit_params = &create_deposit_and_fast_transfer_params.deposit_params;
        let create_fast_transfer_params =
            &create_deposit_and_fast_transfer_params.fast_transfer_params;
        let start_timestamp = test_vaa_args.start_timestamp;
        let sequence = test_vaa_args.sequence;
        let cctp_nonce = test_vaa_args.cctp_nonce;
        let vaa_nonce = test_vaa_args.vaa_nonce;
        let is_posted = test_vaa_args.is_posted;
        let (deposit_vaa_pubkey, deposit_vaa_data, deposit) = create_deposit_message(
            token_mint,
            source_address.clone(),
            destination_address.clone(),
            cctp_mint_recipient,
            deposit_params.amount,
            deposit_params.base_fee,
            test_vaa_args,
        );
        let test_vaa_args = TestVaaArgs {
            start_timestamp,
            sequence: sequence.saturating_add(1),
            cctp_nonce,
            vaa_nonce,
            is_posted,
        };
        let (fast_transfer_vaa_pubkey, fast_transfer_vaa_data, fast_market_order) =
            create_fast_transfer_message(
                source_address.clone(),
                refund_address.clone(),
                destination_address.clone(),
                &test_vaa_args,
                create_fast_transfer_params,
            );
        Self {
            token_mint,
            source_address,
            refund_address,
            destination_address,
            cctp_nonce: u32::try_from(cctp_nonce).unwrap(),
            sequence,
            deposit_vaa: TestVaa {
                kind: TestVaaKind::Deposit,
                vaa_pubkey: deposit_vaa_pubkey,
                vaa_data: deposit_vaa_data,
                payload_deserialized: Some(PayloadDeserialized::Deposit(deposit)),
                is_posted,
            },
            fast_transfer_vaa: TestVaa {
                kind: TestVaaKind::FastTransfer,
                vaa_pubkey: fast_transfer_vaa_pubkey,
                vaa_data: fast_transfer_vaa_data,
                payload_deserialized: Some(PayloadDeserialized::FastTransfer(fast_market_order)),
                is_posted,
            },
        }
    }

    /// Adds the VAA pair to the test context
    ///
    /// # Arguments
    ///
    /// * `program_test` - The program test
    pub fn add_to_test(&self, program_test: &mut ProgramTest) {
        self.deposit_vaa
            .vaa_data
            .create_vaa_account(program_test, self.deposit_vaa.vaa_pubkey);
        self.fast_transfer_vaa
            .vaa_data
            .create_vaa_account(program_test, self.fast_transfer_vaa.vaa_pubkey);
    }

    /// Verifies the posted VAA pair
    pub async fn verify_posted_vaa_pair(&self, test_context: &mut ProgramTestContext) {
        let expected_deposit_vaa = self.deposit_vaa.vaa_data.clone();
        let expected_fast_transfer_vaa = self.fast_transfer_vaa.vaa_data.clone();
        {
            let deposit_vaa = test_context
                .banks_client
                .get_account(self.deposit_vaa.vaa_pubkey)
                .await
                .unwrap();
            assert!(deposit_vaa.is_some(), "Deposit VAA not found");
            let deposit_vaa =
                deserialize_with_discriminator::<PostedVaaData>(&deposit_vaa.unwrap().data)
                    .unwrap();
            assert_eq!(deposit_vaa, expected_deposit_vaa);
        }

        {
            let fast_transfer_vaa = test_context
                .banks_client
                .get_account(self.fast_transfer_vaa.vaa_pubkey)
                .await
                .unwrap();
            assert!(fast_transfer_vaa.is_some(), "Fast transfer VAA not found");
            let fast_transfer_vaa =
                deserialize_with_discriminator::<PostedVaaData>(&fast_transfer_vaa.unwrap().data)
                    .unwrap();
            assert_eq!(fast_transfer_vaa, expected_fast_transfer_vaa);
        }
    }

    /// Checks if the VAA pair is posted
    pub fn is_posted(&self) -> bool {
        self.deposit_vaa.is_posted && self.fast_transfer_vaa.is_posted
    }
}

/// Creates a deposit message
///
/// # Arguments
///
/// * `token_mint` - The mint of the token
/// * `source_address` - The source address
/// * `destination_address` - The destination address (always set to solana regardless of the destination chain)
/// * `cctp_mint_recipient` - The CCTP mint recipient
/// * `amount` - The amount of the deposit
/// * `base_fee` - The base fee of the deposit
/// * `test_vaa_args` - The arguments for the test VAA
///
/// # Returns
///
/// * `vaa_address` - The address of the VAA
/// * `posted_vaa_data` - The posted VAA data
/// * `deposit` - The deposit account deserialized
pub fn create_deposit_message(
    token_mint: Pubkey,
    source_address: ChainAddress,
    _destination_address: ChainAddress,
    cctp_mint_recipient: Pubkey,
    amount: i32,
    base_fee: u64,
    test_vaa_args: &TestVaaArgs,
) -> (Pubkey, PostedVaaData, Deposit) {
    let slow_order_response = SlowOrderResponse { base_fee };
    let cctp_nonce = test_vaa_args.cctp_nonce;
    let sequence = test_vaa_args.sequence;
    let vaa_nonce = test_vaa_args.vaa_nonce;
    // Implements TypePrefixedPayload
    let deposit = Deposit {
        token_address: token_mint.to_bytes(),
        amount: ruint::aliases::U256::from(amount),
        source_cctp_domain: source_address.chain.as_cctp_domain(),
        destination_cctp_domain: Chain::Solana.as_cctp_domain(), // Hardcode solana as destination domain
        cctp_nonce,
        burn_source: source_address.address.to_bytes(), // Token router address
        mint_recipient: cctp_mint_recipient.to_bytes(), // Mint recipient program id
        payload: WriteableBytes::new(slow_order_response.to_vec()),
    };

    // TODO: Checks on deposit

    // Sequece == nonce in this case, since only vaas we are submitting are fast transfers
    let posted_vaa_data = PostedVaaData::new(
        source_address.chain,
        deposit.to_vec(),
        source_address.address,
        sequence,
        vaa_nonce,
    );
    let vaa_hash = posted_vaa_data.message_hash();
    let vaa_hash_as_slice = vaa_hash.as_ref();
    let vaa_address =
        Pubkey::find_program_address(&[b"PostedVAA", vaa_hash_as_slice], &CORE_BRIDGE_PID).0;
    (vaa_address, posted_vaa_data, deposit)
}

/// Creates a fast transfer message
///
/// # Arguments
///
/// * `source_address` - The source address
/// * `refund_address` - The refund address
/// * `destination_address` - The destination address
/// * `test_vaa_args` - The arguments for the test VAA
/// * `create_fast_transfer_params` - The parameters for creating a fast transfer
///
/// # Returns
///
/// * `vaa_address` - The address of the VAA
/// * `posted_vaa_data` - The posted VAA data
/// * `fast_market_order` - The fast market order account deserialized
pub fn create_fast_transfer_message(
    source_address: ChainAddress,
    refund_address: ChainAddress,
    destination_address: ChainAddress,
    test_vaa_args: &TestVaaArgs,
    create_fast_transfer_params: &CreateFastTransferParams,
) -> (Pubkey, PostedVaaData, FastMarketOrder) {
    let amount_in = create_fast_transfer_params.amount_in;
    let min_amount_out = create_fast_transfer_params.min_amount_out;
    let max_fee = create_fast_transfer_params.max_fee;
    let init_auction_fee = create_fast_transfer_params.init_auction_fee;
    let start_timestamp = test_vaa_args.start_timestamp;
    let sequence = test_vaa_args.sequence;
    let vaa_nonce = test_vaa_args.vaa_nonce;
    // If start timestamp is not provided, set the deadline to 0
    let deadline = start_timestamp
        .map(|timestamp| timestamp.saturating_add(10))
        .unwrap_or_default();
    // Implements TypePrefixedPayload
    let fast_market_order = FastMarketOrder {
        amount_in,
        min_amount_out,
        target_chain: destination_address.chain.as_chain_id(),
        redeemer: destination_address.address.to_bytes(),
        sender: source_address.address.to_bytes(),
        refund_address: refund_address.address.to_bytes(), // Not used so can be all zeros
        max_fee,                                           // USDC max fee
        init_auction_fee, // USDC init auction fee (the first person to verify a vaa and start an auction will get this fee) so at least rent
        deadline,         // If dealine is 0 then there is no deadline
        redeemer_message: WriteableBytes::new(vec![]),
    };

    // TODO: Checks on fast transfer

    let posted_vaa_data = PostedVaaData::new(
        source_address.chain,
        fast_market_order.to_vec(),
        source_address.address,
        sequence,
        vaa_nonce,
    );
    let vaa_hash = posted_vaa_data.message_hash();
    let vaa_hash_as_slice = vaa_hash.as_ref();
    let vaa_address =
        Pubkey::find_program_address(&[b"PostedVAA", vaa_hash_as_slice], &CORE_BRIDGE_PID).0;
    (vaa_address, posted_vaa_data, fast_market_order)
}

/// A struct representing a collection of test VAA pairs
///
/// # Fields
///
/// * `pairs` - The collection of test VAA pairs
#[derive(Clone)]
pub struct TestVaaPairs(pub Vec<TestVaaPair>);

impl Deref for TestVaaPairs {
    type Target = Vec<TestVaaPair>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for TestVaaPairs {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl TestVaaPairs {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    /// Add a fast transfer to the test, the sequence number and cctp nonce are equal to the index of the test fast transfer
    ///
    /// # Arguments
    ///
    /// * `token_mint` - The mint of the token
    /// * `source_address` - The source address
    /// * `refund_address` - The refund address
    /// * `destination_address` - The destination address
    /// * `cctp_mint_recipient` - The CCTP mint recipient
    /// * `vaa_args` - The arguments for the test VAA
    pub fn add_ft(
        &mut self,
        token_mint: Pubkey,
        source_address: ChainAddress,
        refund_address: ChainAddress,
        destination_address: ChainAddress,
        cctp_mint_recipient: Pubkey,
        vaa_args: &VaaArgs,
    ) {
        let sequence = vaa_args
            .sequence
            .unwrap_or_else(|| u64::try_from(self.len()).unwrap());
        let cctp_nonce = vaa_args
            .cctp_nonce
            .unwrap_or_else(|| sequence.saturating_add(1));
        let vaa_nonce = vaa_args.vaa_nonce.unwrap_or_default();
        let is_posted = vaa_args.post_vaa;
        let create_deposit_and_fast_transfer_params =
            &vaa_args.create_deposit_and_fast_transfer_params;

        let test_vaa_args = TestVaaArgs {
            start_timestamp: vaa_args.start_timestamp,
            sequence,
            cctp_nonce,
            vaa_nonce,
            is_posted,
        };

        let test_fast_transfer = TestVaaPair::new(
            token_mint,
            source_address,
            refund_address,
            destination_address,
            cctp_mint_recipient,
            create_deposit_and_fast_transfer_params,
            &test_vaa_args,
        );
        self.0.push(test_fast_transfer);
    }

    /// Creates a collection of test VAA pairs with a chain and address
    ///
    /// # Arguments
    ///
    /// * `program_test` - The program test
    /// * `mint_address` - The mint address
    /// * `cctp_mint_recipient` - The CCTP mint recipient
    /// * `source_chain_and_address` - The source chain and address
    /// * `destination_chain_and_address` - The destination chain and address
    /// * `vaa_args` - The arguments for the test VAA
    pub fn create_vaas_with_chain_and_address(
        &mut self,
        program_test: &mut ProgramTest,
        mint_address: Pubkey,
        cctp_mint_recipient: Pubkey,
        source_chain_and_address: ChainAndAddress,
        destination_chain_and_address: ChainAndAddress,
        vaa_args: &VaaArgs,
    ) {
        let source_address = ChainAddress::new_with_address(
            source_chain_and_address.chain,
            source_chain_and_address.address,
        );
        let destination_address = ChainAddress::new_with_address(
            destination_chain_and_address.chain,
            destination_chain_and_address.address,
        );
        let refund_address = source_address.clone();
        self.add_ft(
            mint_address,
            source_address,
            refund_address,
            destination_address,
            cctp_mint_recipient,
            vaa_args,
        );
        if vaa_args.post_vaa {
            for test_fast_transfer in self.0.iter() {
                test_fast_transfer.add_to_test(program_test);
            }
        }
    }

    pub async fn verify_posted_vaas(&self, test_context: &mut ProgramTestContext) {
        for vaa_pair in self.0.iter() {
            if vaa_pair.is_posted() {
                vaa_pair.verify_posted_vaa_pair(test_context).await;
            }
        }
    }
}

/// A struct representing the arguments for creating a test VAA
///
/// # Fields
///
/// * `sequence` - The sequence number
/// * `cctp_nonce` - The CCTP nonce
/// * `vaa_nonce` - The VAA nonce
/// * `start_timestamp` - The start timestamp
/// * `post_vaa` - Whether to post the VAA
/// * `create_deposit_and_fast_transfer_params` - The parameters for creating a deposit and fast transfer
#[derive(Default)]
pub struct VaaArgs {
    pub sequence: Option<u64>,
    pub cctp_nonce: Option<u64>,
    pub vaa_nonce: Option<u32>,
    pub start_timestamp: Option<u32>,
    pub post_vaa: bool,
    pub create_deposit_and_fast_transfer_params: CreateDepositAndFastTransferParams,
}

pub struct ChainAndAddress {
    pub chain: Chain,
    pub address: [u8; 32],
}

/// Creates a collection of test VAA pairs with a chain and address (one deposit and one fast transfer per chain)
///
/// # Arguments
///
/// * `program_test` - The program test
/// * `mint_address` - The mint address
/// * `cctp_mint_recipient` - The CCTP mint recipient
/// * `source_chain_and_address` - The source chain and address
/// * `destination_chain_and_address` - The destination chain and address
/// * `vaa_args` - The arguments for the test VAA
///
/// # Returns
///
/// * `test_vaa_pairs` - The collection of test VAA pairs
pub fn create_vaas_test_with_chain_and_address(
    program_test: &mut ProgramTest,
    mint_address: Pubkey,
    cctp_mint_recipient: Pubkey,
    source_chain_and_address: ChainAndAddress,
    destination_chain_and_address: ChainAndAddress,
    vaa_args: VaaArgs,
) -> TestVaaPairs {
    let mut test_fast_transfers = TestVaaPairs::new();
    test_fast_transfers.create_vaas_with_chain_and_address(
        program_test,
        mint_address,
        cctp_mint_recipient,
        source_chain_and_address,
        destination_chain_and_address,
        &vaa_args,
    );
    test_fast_transfers
}
