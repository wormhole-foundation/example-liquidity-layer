use anchor_lang::prelude::*;
use common::messages::{FastMarketOrder, SlowOrderResponse};
use common::messages::wormhole_io::{WriteableBytes, TypePrefixedPayload};
use common::wormhole_cctp_solana::wormhole::VaaAccount; // TODO: Remove this if not needed
use common::wormhole_cctp_solana::messages::Deposit; // Implements to_vec() under PrefixedPayload
use matching_engine::accounts::{FastOrderPath, LiquidityLayerVaa, LiveRouterPath}; // TODO: Remove this if not needed

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

    pub fn digest(&self) -> [u8; 32] {
        keccak::hashv(&[self.message_hash().as_ref()]).as_ref().try_into().unwrap()
    }

    pub fn create_vaa_account(&self, program_test: &mut ProgramTest) -> Pubkey {
        let vaa_hash = self.message_hash();
        let vaa_hash_as_slice = vaa_hash.as_ref();
        let vaa_address = Pubkey::find_program_address(&[b"PostedVAA", vaa_hash_as_slice], &CORE_BRIDGE_PID).0;
        
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
        vaa_address
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
    pub fn new(program_test: &mut ProgramTest, start_timestamp: Option<u32>, token_mint: Pubkey, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64, cctp_mint_recipient: Pubkey) -> Self {
        let (deposit_vaa_pubkey, deposit_vaa_data) = create_deposit_message(program_test, token_mint, source_address.clone(), destination_address.clone(), cctp_nonce, sequence, cctp_mint_recipient);
        let (fast_transfer_vaa_pubkey, fast_transfer_vaa_data) = create_fast_transfer_message(program_test, start_timestamp, source_address.clone(), refund_address.clone(), destination_address.clone(), cctp_nonce, sequence);
        Self { token_mint, source_address, refund_address, destination_address, cctp_nonce:cctp_nonce as u32, sequence, deposit_vaa: TestVaa { kind: TestVaaKind::Deposit, vaa_pubkey: deposit_vaa_pubkey, vaa_data: deposit_vaa_data }, fast_transfer_vaa: TestVaa { kind: TestVaaKind::FastTransfer, vaa_pubkey: fast_transfer_vaa_pubkey, vaa_data: fast_transfer_vaa_data } }
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

pub fn create_deposit_message(program_test: &mut ProgramTest, token_mint: Pubkey, source_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64, cctp_mint_recipient: Pubkey) -> (Pubkey, PostedVaaData) {
    
    let slow_order_response = SlowOrderResponse {
        base_fee: 0,
    };
    // Implements TypePrefixedPayload
    let deposit = Deposit {
        token_address: token_mint.to_bytes(),
        amount: ruint::aliases::U256::from(100),
        source_cctp_domain: CHAIN_TO_DOMAIN[source_address.chain as usize].1,
        destination_cctp_domain: CHAIN_TO_DOMAIN[destination_address.chain as usize].1,
        cctp_nonce,
        burn_source: source_address.address.to_bytes(), // Token router address
        mint_recipient: cctp_mint_recipient.to_bytes(), // Mint recipient program id
        payload: WriteableBytes::new(slow_order_response.to_vec()),
    };

    // Sequece == nonce in this case, since only vaas we are submitting are fast transfers
    let posted_vaa_data = PostedVaaData::new(source_address.chain, deposit.to_vec(), source_address.address, sequence, cctp_nonce as u32);
    let vaa_address = posted_vaa_data.create_vaa_account(program_test);
    (vaa_address, posted_vaa_data)
}

pub fn create_fast_transfer_message(program_test: &mut ProgramTest, start_timestamp: Option<u32>, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_nonce: u64, sequence: u64) -> (Pubkey, PostedVaaData) {
    // If start timestamp is not provided, set the deadline to 0
    let deadline = start_timestamp.map(|timestamp| timestamp + 10).unwrap_or(0);
    // Implements TypePrefixedPayload
    let fast_market_order = FastMarketOrder {
        amount_in: 1000,
        min_amount_out: 1000,
        target_chain: destination_address.chain.to_chain_id(),
        redeemer: destination_address.address.to_bytes(),
        sender: source_address.address.to_bytes(),
        refund_address: refund_address.address.to_bytes(), // Not used so can be all zeros
        max_fee: 1000000000, // USDC max fee
        init_auction_fee: 10, // USDC init auction fee (the first person to verify a vaa and start an auction will get this fee) so at least rent
        deadline, // If dealine is 0 then there is no deadline
        redeemer_message: WriteableBytes::new(vec![]),
    };

    let posted_vaa_data = PostedVaaData::new(source_address.chain, fast_market_order.to_vec(), source_address.address, sequence, cctp_nonce as u32);
    let vaa_address = posted_vaa_data.create_vaa_account(program_test);
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
    pub fn add_ft(&mut self, program_test: &mut ProgramTest, start_timestamp: Option<u32>, token_mint: Pubkey, source_address: ChainAddress, refund_address: ChainAddress, destination_address: ChainAddress, cctp_mint_recipient: Pubkey) {
        let sequence = self.len() as u64;
        let cctp_nonce = sequence;
        let test_fast_transfer = TestFastTransfer::new(program_test, start_timestamp, token_mint, source_address, refund_address, destination_address, cctp_nonce, sequence, cctp_mint_recipient);
        self.0.push(test_fast_transfer);
    }
}

pub fn create_vaas_test(program_test: &mut ProgramTest, mint_address: Pubkey, start_timestamp: Option<u32>, cctp_mint_recipient: Pubkey) -> TestFastTransfers {
    let mut test_fast_transfers = TestFastTransfers::new();
    let source_address = ChainAddress::new_unique(Chain::Arbitrum);
    let destination_address = ChainAddress::new_unique(Chain::Ethereum);
    let refund_address = source_address.clone();
    test_fast_transfers.add_ft(program_test, start_timestamp, mint_address.clone(), source_address, refund_address, destination_address, cctp_mint_recipient);
    test_fast_transfers
}

pub fn create_vaas_test_with_chain_and_address(program_test: &mut ProgramTest, mint_address: Pubkey, start_timestamp: Option<u32>, cctp_mint_recipient: Pubkey, source_chain: Chain, destination_chain: Chain, source_address: [u8; 32], destination_address: [u8; 32]) -> TestFastTransfers {
    let mut test_fast_transfers = TestFastTransfers::new();
    let source_address = ChainAddress::new_with_address(source_chain, source_address);
    let destination_address = ChainAddress::new_with_address(destination_chain, destination_address);
    let refund_address = source_address.clone();
    test_fast_transfers.add_ft(program_test, start_timestamp, mint_address.clone(), source_address, refund_address, destination_address, cctp_mint_recipient);
    test_fast_transfers
}
pub trait ToBytes {
    fn to_bytes(&self) ->[u8; 32];
}

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

    pub fn new_with_address(chain: Chain, address: [u8; 32]) -> Self {
        Self { chain, address: TestPubkey::Bytes(address) }
    }
}

