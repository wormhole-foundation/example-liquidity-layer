use anchor_lang::prelude::*;
use common::messages::{FastMarketOrder, SlowOrderResponse};
use common::messages::wormhole_io::{WriteableBytes, TypePrefixedPayload};
use common::wormhole_cctp_solana::messages::Deposit; // Implements to_vec() under PrefixedPayload
use secp256k1::SecretKey as SecpSecretKey;

use super::constants::Chain;
use super::CHAIN_TO_DOMAIN;

use borsh::{
    BorshDeserialize,
    BorshSerialize,
};
use serde::{
    Deserialize,
    Serialize,
};
use solana_sdk::account::Account;
use super::constants::CORE_BRIDGE_PID;
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_program::keccak;
use std::cell::RefCell;
use std::rc::Rc;

pub trait DataDiscriminator {
    const DISCRIMINATOR: &'static [u8];
}

#[derive(Debug, Default, BorshSerialize, BorshDeserialize, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PostedVaaData {
    /// Header of the posted VAA
    // pub vaa_version: u8, (This is removed because it is encoded in the discriminator)

    /// Level of consistency requested by the emitter
    pub consistency_level: u8,

    /// Time the vaa was submitted
    pub vaa_time: u32,

    /// Account where signatures are stored
    pub vaa_signature_account: Pubkey,

    /// Time the posted message was created
    pub submission_time: u32,

    /// Unique nonce for this message
    pub nonce: u32,

    /// Sequence number of this message
    pub sequence: u64,

    /// Emitter of the message
    pub emitter_chain: u16,

    /// Emitter of the message
    pub emitter_address: [u8; 32],

    /// Message payload
    pub payload: Vec<u8>,
}

impl DataDiscriminator for PostedVaaData {
    const DISCRIMINATOR: &'static [u8] = b"vaa\x01";
}

impl PostedVaaData {
    pub fn new(
        chain: Chain, payload: Vec<u8>, emitter_address: impl ToBytes, sequence: u64, nonce: u32
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;
        let emitter_chain = chain.to_chain_id();
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

    pub fn sign_with_guardian_key(&self, guardian_secret_key: &SecpSecretKey, index: u8) -> [u8; 66] {
        // Sign the message hash with the guardian key
        let secp = secp256k1::SECP256K1;
        let msg = secp256k1::Message::from_digest(self.digest());
        let recoverable_signature = secp.sign_ecdsa_recoverable(&msg, &guardian_secret_key);
        let mut signature_bytes = [0u8; 66];
        // First byte is the index
        signature_bytes[0] = index;
        // Next 64 bytes are the signature in compact format
        let (recovery_id, compact_sig) = recoverable_signature.serialize_compact();
        // Recovery ID goes in byte 65
        signature_bytes[1..65].copy_from_slice(&compact_sig);
        signature_bytes[65] = i32::from(recovery_id) as u8;
        signature_bytes
    }

    pub fn digest(&self) -> [u8; 32] {
        keccak::hashv(&[self.message_hash().as_ref()]).as_ref().try_into().unwrap()
    }

    pub fn create_vaa_account(&self, program_test: &mut ProgramTest, vaa_address: Pubkey) {
        let vaa_data_serialized = serialize_with_discriminator(self).unwrap();
        let lamports = solana_sdk::rent::Rent::default().minimum_balance(vaa_data_serialized.len());
        let vaa_account = Account {
            lamports: lamports,
            data: vaa_data_serialized,
            owner: CORE_BRIDGE_PID,
            executable: false,
            rent_epoch: u64::MAX,
        };
        program_test.add_account(vaa_address, vaa_account);
    }
}

pub fn deserialize_with_discriminator<T: BorshDeserialize + DataDiscriminator>(data: &[u8]) -> Option<T> {
    let mut discriminant = [0u8; 4];
    discriminant.copy_from_slice(&data[..4]);
    if discriminant != T::DISCRIMINATOR {
        return None;
    }
    let mut data = data[4..].to_vec();
    let message = T::try_from_slice(&mut data);
    match message {
        Ok(message) => Some(message),
        Err(_) => None,
    }
}

pub fn serialize_with_discriminator<T>(message: &T) -> Result<Vec<u8>> 
where
    T: BorshSerialize + DataDiscriminator
{
    let mut data = Vec::new();
    data.extend_from_slice(T::DISCRIMINATOR);
    message.serialize(&mut data)?;
    Ok(data)
}

#[derive(Clone)]
pub struct TestVaa {
    pub kind: TestVaaKind,
    pub vaa_pubkey: Pubkey,
    pub vaa_data: PostedVaaData,
}

impl TestVaa {
    pub fn get_vaa_pubkey(&self) -> Pubkey {
        self.vaa_pubkey.clone()
    }
}

#[derive(Clone)]
pub enum TestVaaKind {
    Deposit,
    FastTransfer,
}

pub struct CreateDepositAndFastTransferParams {
    pub deposit_params: CreateDepositParams,
    pub fast_transfer_params: CreateFastTransferParams,
}

impl Default for CreateDepositAndFastTransferParams {
    fn default() -> Self {
        Self { deposit_params: CreateDepositParams::default(), fast_transfer_params: CreateFastTransferParams::default() }
    }
}

impl CreateDepositAndFastTransferParams {
    pub fn verify(&self) {
        assert!(self.fast_transfer_params.max_fee > self.deposit_params.base_fee + self.fast_transfer_params.init_auction_fee, "Max fee must be greater than the sum of the base fee and the init auction fee");
        assert!(self.fast_transfer_params.amount_in > self.fast_transfer_params.max_fee , "Amount in must be greater than max fee");
    }
}

pub struct CreateDepositParams {
    pub amount: i32,
    pub base_fee: u64,
}

impl Default for CreateDepositParams {
    fn default() -> Self {
        Self { amount: 69000000, base_fee: 0 }
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
        Self { amount_in: 69000000, min_amount_out: 69000000, max_fee: 6000000, init_auction_fee: 10 }
    }
}

pub struct TestFastTransfer {
    pub token_mint: Pubkey,
    pub source_address: ChainAddress,
    pub refund_address: ChainAddress,
    pub destination_address: ChainAddress,
    pub cctp_nonce: u32,
    pub sequence: u64,
    pub fast_transfer_vaa: TestVaa, // kind: TestVaaKind::FastTransfer
    pub deposit_vaa: TestVaa, // kind: TestVaaKind::Deposit
}

impl TestFastTransfer {
    pub fn new(start_timestamp: Option<u32>, token_mint: Pubkey, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64, cctp_mint_recipient: Pubkey, create_deposit_and_fast_transfer_params: CreateDepositAndFastTransferParams) -> Self {
        create_deposit_and_fast_transfer_params.verify();
        let deposit_params = create_deposit_and_fast_transfer_params.deposit_params;
        let create_fast_transfer_params = create_deposit_and_fast_transfer_params.fast_transfer_params;
        let (deposit_vaa_pubkey, deposit_vaa_data) = create_deposit_message(token_mint, source_address.clone(), destination_address.clone(), cctp_nonce, sequence, cctp_mint_recipient, deposit_params.amount, deposit_params.base_fee);
        let (fast_transfer_vaa_pubkey, fast_transfer_vaa_data) = create_fast_transfer_message(start_timestamp, source_address.clone(), refund_address.clone(), destination_address.clone(), cctp_nonce, sequence, create_fast_transfer_params.amount_in, create_fast_transfer_params.min_amount_out, create_fast_transfer_params.max_fee, create_fast_transfer_params.init_auction_fee);
        Self { token_mint, source_address, refund_address, destination_address, cctp_nonce:cctp_nonce as u32, sequence, deposit_vaa: TestVaa { kind: TestVaaKind::Deposit, vaa_pubkey: deposit_vaa_pubkey, vaa_data: deposit_vaa_data }, fast_transfer_vaa: TestVaa { kind: TestVaaKind::FastTransfer, vaa_pubkey: fast_transfer_vaa_pubkey, vaa_data: fast_transfer_vaa_data } }
    }

    pub fn add_to_test(&self, program_test:&mut ProgramTest) {
        self.deposit_vaa.vaa_data.create_vaa_account(program_test, self.deposit_vaa.vaa_pubkey.clone());
        self.fast_transfer_vaa.vaa_data.create_vaa_account(program_test, self.fast_transfer_vaa.vaa_pubkey.clone());
    }

    pub async fn verify_vaas(&self, test_context: &Rc<RefCell<ProgramTestContext>>) {
        let expected_deposit_vaa = self.deposit_vaa.vaa_data.clone();
        let expected_fast_transfer_vaa = self.fast_transfer_vaa.vaa_data.clone();
        {
            let deposit_vaa = test_context.borrow_mut().banks_client.get_account(self.deposit_vaa.vaa_pubkey.clone()).await.unwrap();
            assert!(deposit_vaa.is_some(), "Deposit VAA not found");
            let deposit_vaa = deserialize_with_discriminator::<PostedVaaData>(&deposit_vaa.unwrap().data).unwrap();
            assert_eq!(deposit_vaa, expected_deposit_vaa);
        }

        {
            let fast_transfer_vaa = test_context.borrow_mut().banks_client.get_account(self.fast_transfer_vaa.vaa_pubkey.clone()).await.unwrap();
            assert!(fast_transfer_vaa.is_some(), "Fast transfer VAA not found");
            let fast_transfer_vaa = deserialize_with_discriminator::<PostedVaaData>(&fast_transfer_vaa.unwrap().data).unwrap();
            assert_eq!(fast_transfer_vaa, expected_fast_transfer_vaa);
        }
    }
}

pub fn create_deposit_message(token_mint: Pubkey, source_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64, cctp_mint_recipient: Pubkey, amount: i32, base_fee: u64) -> (Pubkey, PostedVaaData) {
    
    let slow_order_response = SlowOrderResponse {
        base_fee,
    };
    // Implements TypePrefixedPayload
    let deposit = Deposit {
        token_address: token_mint.to_bytes(),
        amount: ruint::aliases::U256::from(amount),
        source_cctp_domain: CHAIN_TO_DOMAIN[source_address.chain as usize].1,
        destination_cctp_domain: CHAIN_TO_DOMAIN[destination_address.chain as usize].1,
        cctp_nonce,
        burn_source: source_address.address.to_bytes(), // Token router address
        mint_recipient: cctp_mint_recipient.to_bytes(), // Mint recipient program id
        payload: WriteableBytes::new(slow_order_response.to_vec()),
    };

    // TODO: Checks on deposit

    // Sequece == nonce in this case, since only vaas we are submitting are fast transfers
    let posted_vaa_data = PostedVaaData::new(source_address.chain, deposit.to_vec(), source_address.address, sequence, cctp_nonce as u32);
    let vaa_hash = posted_vaa_data.message_hash();
    let vaa_hash_as_slice = vaa_hash.as_ref();
    let vaa_address = Pubkey::find_program_address(&[b"PostedVAA", vaa_hash_as_slice], &CORE_BRIDGE_PID).0;
    (vaa_address, posted_vaa_data)
}

pub fn create_fast_transfer_message(start_timestamp: Option<u32>, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64, amount_in: u64, min_amount_out: u64, max_fee: u64, init_auction_fee: u64) -> (Pubkey, PostedVaaData) {
    // If start timestamp is not provided, set the deadline to 0
    let deadline = start_timestamp.map(|timestamp| timestamp + 10).unwrap_or(0);
    // Implements TypePrefixedPayload
    let fast_market_order = FastMarketOrder {
        amount_in,
        min_amount_out,
        target_chain: destination_address.chain.to_chain_id(),
        redeemer: destination_address.address.to_bytes(),
        sender: source_address.address.to_bytes(),
        refund_address: refund_address.address.to_bytes(), // Not used so can be all zeros
        max_fee, // USDC max fee
        init_auction_fee, // USDC init auction fee (the first person to verify a vaa and start an auction will get this fee) so at least rent
        deadline, // If dealine is 0 then there is no deadline
        redeemer_message: WriteableBytes::new(vec![]),
    };

    // TODO: Checks on fast transfer

    let posted_vaa_data = PostedVaaData::new(source_address.chain, fast_market_order.to_vec(), source_address.address, sequence, cctp_nonce as u32);
    let vaa_hash = posted_vaa_data.message_hash();
    let vaa_hash_as_slice = vaa_hash.as_ref();
    let vaa_address = Pubkey::find_program_address(&[b"PostedVAA", vaa_hash_as_slice], &CORE_BRIDGE_PID).0;
    (vaa_address, posted_vaa_data)
}

pub struct TestFastTransfers(pub Vec<TestFastTransfer>);

impl TestFastTransfers {
    pub fn new() -> Self {
        Self(Vec::new())
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Add a fast transfer to the test, the sequence number and cctp nonce are equal to the index of the test fast transfer
    pub fn add_ft(&mut self, start_timestamp: Option<u32>, token_mint: Pubkey, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_mint_recipient: Pubkey, sequence: Option<u64>, nonce: Option<u64>, create_deposit_and_fast_transfer_params: CreateDepositAndFastTransferParams) {
        let sequence = sequence.unwrap_or(self.len() as u64);
        let cctp_nonce = nonce.unwrap_or(sequence);
        let test_fast_transfer = TestFastTransfer::new(start_timestamp, token_mint, source_address, refund_address, destination_address, cctp_nonce, sequence, cctp_mint_recipient, create_deposit_and_fast_transfer_params);
        self.0.push(test_fast_transfer);
    }

    pub fn create_vaas_with_chain_and_address(&mut self, program_test: &mut ProgramTest, mint_address: Pubkey, start_timestamp: Option<u32>, cctp_mint_recipient: Pubkey, source_chain: Chain, destination_chain: Chain, source_address: [u8; 32], destination_address: [u8; 32], sequence: Option<u64>, nonce: Option<u64>, create_deposit_and_fast_transfer_params: CreateDepositAndFastTransferParams, add_fast_transfer_to_test: bool) {
        let source_address = ChainAddress::new_with_address(source_chain, source_address);
        let destination_address = ChainAddress::new_with_address(destination_chain, destination_address);
        let refund_address = source_address.clone();
        self.add_ft(start_timestamp, mint_address.clone(), source_address, refund_address, destination_address, cctp_mint_recipient, sequence, nonce, create_deposit_and_fast_transfer_params);
        if add_fast_transfer_to_test {
            for test_fast_transfer in self.0.iter() {
                test_fast_transfer.add_to_test(program_test);
            }
        }
    }
}

pub fn create_vaas_test_with_chain_and_address(
    program_test: &mut ProgramTest, 
    mint_address: Pubkey, 
    start_timestamp: Option<u32>, 
    cctp_mint_recipient: Pubkey, 
    source_chain: Chain, 
    destination_chain: Chain, 
    source_address: [u8; 32], 
    destination_address: [u8; 32],
    sequence: Option<u64>,
    nonce: Option<u64>,
    add_fast_transfer_to_test: bool,
) -> TestFastTransfers {
    let mut test_fast_transfers = TestFastTransfers::new();
    let create_deposit_and_fast_transfer_params = CreateDepositAndFastTransferParams::default();
    test_fast_transfers.create_vaas_with_chain_and_address(program_test, mint_address, start_timestamp, cctp_mint_recipient, source_chain, destination_chain, source_address, destination_address, sequence, nonce, create_deposit_and_fast_transfer_params, add_fast_transfer_to_test);
    test_fast_transfers
}
pub trait ToBytes {
    fn to_bytes(&self) ->[u8; 32];
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum TestPubkey {
    Solana(Pubkey),
    Evm(EvmAddress),
    Bytes([u8; 32]),
}

impl ToBytes for TestPubkey {
    fn to_bytes(&self) -> [u8; 32] {
        match self {
            TestPubkey::Solana(pubkey) => pubkey.to_bytes(),
            TestPubkey::Evm(evm_address) => evm_address.to_bytes(),
            TestPubkey::Bytes(bytes) => *bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvmAddress([u8; 20]);

#[allow(dead_code)]
impl EvmAddress {
    pub fn new(bytes: [u8; 20]) -> Self {
        Self(bytes)
    }
    
    pub fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.strip_prefix("0x").unwrap_or(hex);
        let bytes = hex::decode(hex).ok()?;
        if bytes.len() != 20 {
            return None;
        }
        let mut array = [0u8; 20];
        array.copy_from_slice(&bytes);
        Some(Self(array))
    }
    
    pub fn as_bytes(&self) -> &[u8; 20] {
        &self.0
    }
    
    pub fn to_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }

    pub fn new_unique() -> Self {
        let (_secp_secret_key, secp_pubkey) = secp256k1::generate_keypair(&mut secp256k1::rand::rngs::OsRng);
        // Get uncompressed public key bytes (65 bytes: prefix + x + y)
        let uncompressed = secp_pubkey.serialize_uncompressed();
        // Hash with Keccak-256 removing the prefix
        let hash = keccak::hashv(&[&uncompressed[1..]]);
        // Address is the last 20 bytes of the hash
        let address: [u8; 20] = hash.as_ref()[12..].try_into().unwrap();
        Self(address)
    }
}

impl ToBytes for EvmAddress {
    fn to_bytes(&self) -> [u8; 32] {
        // Pad the evm address with 12 zero bytes
        let mut bytes = vec![0u8; 12];
        bytes.extend_from_slice(&self.0);
        bytes.try_into().unwrap()
    }
}

#[derive(Clone)]
pub struct ChainAddress {
    pub chain: Chain,
    pub address: TestPubkey,
}

impl ChainAddress {
    #[allow(dead_code)]
    pub fn new_unique(chain: Chain) -> Self {
        match chain {
            Chain::Solana => Self { chain, address: TestPubkey::Solana(Pubkey::new_unique()) },
            Chain::Ethereum => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
            Chain::Arbitrum => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
            Chain::Avalanche => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
            Chain::Optimism => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
            Chain::Polygon => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
            Chain::Base => Self { chain, address: TestPubkey::Evm(EvmAddress::new_unique()) },
        }
    }

    #[allow(dead_code)]
    pub fn new_with_address(chain: Chain, address: [u8; 32]) -> Self {
        Self { chain, address: TestPubkey::Bytes(address) }
    }
}

