use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::cctp::message_transmitter_program::MessageTransmitterConfig;
use num_traits::FromBytes;
use solana_sdk::keccak;
use std::fmt::Display;
use solana_program::keccak::{Hash, Hasher};
use secp256k1::SecretKey as SecpSecretKey;
use std::str::FromStr;
use std::rc::Rc;
use std::cell::RefCell;
use solana_program_test::ProgramTestContext;
use common::wormhole_cctp_solana::cctp::{MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID};


use crate::utils::ETHEREUM_USDC_ADDRESS;

use super::{Chain, CHAIN_TO_DOMAIN, GUARDIAN_SECRET_KEY};

// Imported from https://github.com/circlefin/solana-cctp-contracts.git rev = "4477f88"

#[error_code]
pub enum MathError {
    #[msg("Overflow in arithmetic operation")]
    MathOverflow,
    #[msg("Underflow in arithmetic operation")]
    MathUnderflow,
    #[msg("Error in division operation")]
    ErrorInDivision,
}

#[error_code]
pub enum MessageTransmitterError {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Instruction is not allowed at this time")]
    ProgramPaused,
    #[msg("Invalid message transmitter state")]
    InvalidMessageTransmitterState,
    #[msg("Invalid signature threshold")]
    InvalidSignatureThreshold,
    #[msg("Signature threshold already set")]
    SignatureThresholdAlreadySet,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Invalid pauser")]
    InvalidPauser,
    #[msg("Invalid attester manager")]
    InvalidAttesterManager,
    #[msg("Invalid attester")]
    InvalidAttester,
    #[msg("Attester already enabled")]
    AttesterAlreadyEnabled,
    #[msg("Too few enabled attesters")]
    TooFewEnabledAttesters,
    #[msg("Signature threshold is too low")]
    SignatureThresholdTooLow,
    #[msg("Attester already disabled")]
    AttesterAlreadyDisabled,
    #[msg("Message body exceeds max size")]
    MessageBodyLimitExceeded,
    #[msg("Invalid destination caller")]
    InvalidDestinationCaller,
    #[msg("Invalid message recipient")]
    InvalidRecipient,
    #[msg("Sender is not permitted")]
    SenderNotPermitted,
    #[msg("Invalid source domain")]
    InvalidSourceDomain,
    #[msg("Invalid destination domain")]
    InvalidDestinationDomain,
    #[msg("Invalid message version")]
    InvalidMessageVersion,
    #[msg("Invalid used nonces account")]
    InvalidUsedNoncesAccount,
    #[msg("Invalid recipient program")]
    InvalidRecipientProgram,
    #[msg("Invalid nonce")]
    InvalidNonce,
    #[msg("Nonce already used")]
    NonceAlreadyUsed,
    #[msg("Message is too short")]
    MessageTooShort,
    #[msg("Malformed message")]
    MalformedMessage,
    #[msg("Invalid signature order or dupe")]
    InvalidSignatureOrderOrDupe,
    #[msg("Invalid attester signature")]
    InvalidAttesterSignature,
    #[msg("Invalid attestation length")]
    InvalidAttestationLength,
    #[msg("Invalid signature recovery ID")]
    InvalidSignatureRecoveryId,
    #[msg("Invalid signature S value")]
    InvalidSignatureSValue,
    #[msg("Invalid message hash")]
    InvalidMessageHash,
}

#[error_code]
pub enum TokenMessengerError {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Invalid token messenger state")]
    InvalidTokenMessengerState,
    #[msg("Invalid token messenger")]
    InvalidTokenMessenger,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Malformed message")]
    MalformedMessage,
    #[msg("Invalid message body version")]
    InvalidMessageBodyVersion,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid destination domain")]
    InvalidDestinationDomain,
    #[msg("Invalid destination caller")]
    InvalidDestinationCaller,
    #[msg("Invalid mint recipient")]
    InvalidMintRecipient,
    #[msg("Invalid sender")]
    InvalidSender,
    #[msg("Invalid token pair")]
    InvalidTokenPair,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
}

//https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/token-messenger-minter/src/token_messenger/state.rs#L35-L38
#[derive(Debug, InitSpace)]
pub struct CctpRemoteTokenMessenger {
    pub domain: u32, // Big endian
    pub token_messenger: Pubkey,
}

impl CctpRemoteTokenMessenger {
    pub fn new(domain: u32, token_messenger: Pubkey) -> Self {
        Self { domain, token_messenger }
    }

    pub fn try_deserialize(data: &[u8]) -> Result<Self> {
        require_eq!(data.len(), 36, TokenMessengerError::MalformedMessage);
        let domain = u32::from_be_bytes(data[0..4].try_into().unwrap());
        let token_messenger = Pubkey::try_from(&data[4..36]).unwrap();
        Ok(Self { domain, token_messenger })
    }
}

// https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/message-transmitter/src/message.rs#L30
#[derive(Clone, Debug)]
pub struct Message<'a> {
    data: &'a [u8],
}

pub fn checked_add<T>(arg1: T, arg2: T) -> Result<T>
where
    T: num_traits::PrimInt + Display,
{
    if let Some(res) = arg1.checked_add(&arg2) {
        Ok(res)
    } else {
        msg!("Error: Overflow in {} + {}", arg1, arg2);
        err!(MathError::MathOverflow)
    }
}

impl<'a> Message<'a> {
    // Indices of each field in the message
    const VERSION_INDEX: usize = 0;
    const SOURCE_DOMAIN_INDEX: usize = 4;
    const DESTINATION_DOMAIN_INDEX: usize = 8;
    const NONCE_INDEX: usize = 12;
    const SENDER_INDEX: usize = 20;
    const RECIPIENT_INDEX: usize = 52;
    const DESTINATION_CALLER_INDEX: usize = 84;
    const MESSAGE_BODY_INDEX: usize = 116;

    /// Validates source array size and returns a new message
    pub fn new(expected_version: u32, message_bytes: &'a [u8]) -> Result<Self> {
        require_gte!(
            message_bytes.len(),
            Self::MESSAGE_BODY_INDEX        
        );
        let message = Self {
            data: message_bytes,
        };
        require_eq!(
            expected_version,
            message.version()?,
        );
        Ok(message)
    }

    pub fn serialized_len(message_body_len: usize) -> Result<usize> {
        checked_add(Self::MESSAGE_BODY_INDEX, message_body_len)
    }

    #[allow(clippy::too_many_arguments)]
    /// Serializes given fields into a message
    pub fn format_message(
        version: u32,
        local_domain: u32,
        destination_domain: u32,
        nonce: u64,
        sender: &Pubkey,
        recipient: &Pubkey,
        destination_caller: &Pubkey,
        message_body: &Vec<u8>,
    ) -> Result<Vec<u8>> {
        let mut output = vec![0; Message::serialized_len(message_body.len())?];

        output[Self::VERSION_INDEX..Self::SOURCE_DOMAIN_INDEX]
            .copy_from_slice(&version.to_be_bytes());
        output[Self::SOURCE_DOMAIN_INDEX..Self::DESTINATION_DOMAIN_INDEX]
            .copy_from_slice(&local_domain.to_be_bytes());
        output[Self::DESTINATION_DOMAIN_INDEX..Self::NONCE_INDEX]
            .copy_from_slice(&destination_domain.to_be_bytes());
        output[Self::NONCE_INDEX..Self::SENDER_INDEX].copy_from_slice(&nonce.to_be_bytes());
        output[Self::SENDER_INDEX..Self::RECIPIENT_INDEX].copy_from_slice(sender.as_ref());
        output[Self::RECIPIENT_INDEX..Self::DESTINATION_CALLER_INDEX]
            .copy_from_slice(recipient.as_ref());
        output[Self::DESTINATION_CALLER_INDEX..Self::MESSAGE_BODY_INDEX]
            .copy_from_slice(destination_caller.as_ref());
        if !message_body.is_empty() {
            output[Self::MESSAGE_BODY_INDEX..].copy_from_slice(message_body.as_slice());
        }

        Ok(output)
    }

    /// Returns Keccak hash of the message
    pub fn hash(&self) -> Hash {
        let mut hasher = Hasher::default();
        hasher.hash(self.data);
        hasher.result()
    }

    /// Returns version field
    pub fn version(&self) -> Result<u32> {
        self.read_integer::<u32>(Self::VERSION_INDEX)
    }

    /// Returns sender field
    pub fn sender(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::SENDER_INDEX)
    }

    /// Returns recipient field
    pub fn recipient(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::RECIPIENT_INDEX)
    }

    /// Returns source_domain field
    pub fn source_domain(&self) -> Result<u32> {
        self.read_integer::<u32>(Self::SOURCE_DOMAIN_INDEX)
    }

    /// Returns destination_domain field
    pub fn destination_domain(&self) -> Result<u32> {
        self.read_integer::<u32>(Self::DESTINATION_DOMAIN_INDEX)
    }

    /// Returns destination_caller field
    pub fn destination_caller(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::DESTINATION_CALLER_INDEX)
    }

    /// Returns nonce field
    pub fn nonce(&self) -> Result<u64> {
        self.read_integer::<u64>(Self::NONCE_INDEX)
    }

    /// Returns message_body field
    pub fn message_body(&self) -> &[u8] {
        &self.data[Self::MESSAGE_BODY_INDEX..]
    }

    ////////////////////
    // private helpers

    /// Reads integer field at the given offset
    fn read_integer<T>(&self, index: usize) -> Result<T>
    where
        T: num_traits::PrimInt + FromBytes + Display,
        &'a <T as FromBytes>::Bytes: TryFrom<&'a [u8]> + 'a,
    {
        Ok(T::from_be_bytes(
            self.data[index..checked_add(index, std::mem::size_of::<T>())?]
                .try_into()
                .map_err(|_| MessageTransmitterError::MalformedMessage)?,
        ))
    }

    /// Reads pubkey field at the given offset
    fn read_pubkey(&self, index: usize) -> Result<Pubkey> {
        Ok(Pubkey::try_from(
            &self.data[index..checked_add(index, std::mem::size_of::<Pubkey>())?],
        )
        .map_err(|_| MessageTransmitterError::MalformedMessage)?)
    }
}

// https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/token-messenger-minter/src/token_messenger/burn_message.rs#L26
#[derive(Clone, Debug)]
pub struct BurnMessage<'a> {
    data: &'a [u8],
}

impl<'a> BurnMessage<'a> {
    // Indices of each field in the message
    const VERSION_INDEX: usize = 0;
    const BURN_TOKEN_INDEX: usize = 4;
    const MINT_RECIPIENT_INDEX: usize = 36;
    const AMOUNT_INDEX: usize = 68;
    const MSG_SENDER_INDEX: usize = 100;
    // 4 byte version + 32 bytes burnToken + 32 bytes mintRecipient + 32 bytes amount + 32 bytes messageSender
    const BURN_MESSAGE_LEN: usize = 132;
    // EVM amount is 32 bytes while we use only 8 bytes on Solana
    const AMOUNT_OFFSET: usize = 24;

    /// Validates source array size and returns a new message
    pub fn new(expected_version: u32, message_bytes: &'a [u8]) -> Result<Self> {
        require_eq!(
            message_bytes.len(),
            Self::BURN_MESSAGE_LEN,
            TokenMessengerError::MalformedMessage
        );
        let message = Self {
            data: message_bytes,
        };
        require_eq!(
            expected_version,
            message.version()?,
            TokenMessengerError::InvalidMessageBodyVersion
        );
        Ok(message)
    }

    #[allow(clippy::too_many_arguments)]
    /// Serializes given fields into a burn message
    pub fn format_message(
        version: u32,
        burn_token: &Pubkey,
        mint_recipient: &Pubkey,
        amount: u64,
        message_sender: &Pubkey,
    ) -> Result<Vec<u8>> {
        let mut output = vec![0; Self::BURN_MESSAGE_LEN];

        output[Self::VERSION_INDEX..Self::BURN_TOKEN_INDEX].copy_from_slice(&version.to_be_bytes());
        output[Self::BURN_TOKEN_INDEX..Self::MINT_RECIPIENT_INDEX]
            .copy_from_slice(burn_token.as_ref());
        output[Self::MINT_RECIPIENT_INDEX..Self::AMOUNT_INDEX]
            .copy_from_slice(mint_recipient.as_ref());
        output[(Self::AMOUNT_INDEX + Self::AMOUNT_OFFSET)..Self::MSG_SENDER_INDEX]
            .copy_from_slice(&amount.to_be_bytes());
        output[Self::MSG_SENDER_INDEX..Self::BURN_MESSAGE_LEN]
            .copy_from_slice(message_sender.as_ref());

        Ok(output)
    }

    /// Returns version field
    pub fn version(&self) -> Result<u32> {
        self.read_integer::<u32>(Self::VERSION_INDEX)
    }

    /// Returns burn_token field
    pub fn burn_token(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::BURN_TOKEN_INDEX)
    }

    /// Returns mint_recipient field
    pub fn mint_recipient(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::MINT_RECIPIENT_INDEX)
    }

    /// Returns amount field
    pub fn amount(&self) -> Result<u64> {
        require!(
            self.data[Self::AMOUNT_INDEX..(Self::AMOUNT_INDEX + Self::AMOUNT_OFFSET)]
                .iter()
                .all(|&x| x == 0),
            TokenMessengerError::MalformedMessage
        );
        self.read_integer::<u64>(Self::AMOUNT_INDEX + Self::AMOUNT_OFFSET)
    }

    /// Returns message_sender field
    pub fn message_sender(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::MSG_SENDER_INDEX)
    }

    ////////////////////
    // private helpers

    /// Reads integer field at the given offset
    fn read_integer<T>(&self, index: usize) -> Result<T>
    where
        T: num_traits::PrimInt + FromBytes + Display,
        &'a <T as FromBytes>::Bytes: TryFrom<&'a [u8]> + 'a,
    {
        Ok(T::from_be_bytes(
            self.data[index..checked_add(index, std::mem::size_of::<T>())?]
                .try_into()
                .map_err(|_| TokenMessengerError::MalformedMessage)?,
        ))
    }

    /// Reads pubkey field at the given offset
    fn read_pubkey(&self, index: usize) -> Result<Pubkey> {
        Ok(Pubkey::try_from(
            &self.data[index..checked_add(index, std::mem::size_of::<Pubkey>())?],
        )
        .map_err(|_| TokenMessengerError::MalformedMessage)?)
    }
}

pub struct CircleAttester {
    // You'll need to define a private key constant similar to GUARDIAN_KEY in TypeScript
    guardian_secret_key: SecpSecretKey,
}

impl CircleAttester {

    pub fn create_attestation(&self, message: &[u8]) -> [u8; 65] {
        // Sign the message hash with the guardian key
        let secp = secp256k1::SECP256K1;
        let digest = keccak::hash(message).to_bytes();
        let msg = secp256k1::Message::from_digest(digest);
        let recoverable_signature = secp.sign_ecdsa_recoverable(&msg, &self.guardian_secret_key);
        let mut signature_bytes = [0u8; 65];
        // Next 64 bytes are the signature in compact format
        let (recovery_id, compact_sig) = recoverable_signature.serialize_compact();
        // Recovery ID goes in byte 65
        signature_bytes[0..64].copy_from_slice(&compact_sig);
        signature_bytes[64] = i32::from(recovery_id) as u8;
        signature_bytes
    }
}

impl Default for CircleAttester {
    fn default() -> Self {
        let guardian_secret_key = secp256k1::SecretKey::from_str(GUARDIAN_SECRET_KEY).expect("Failed to parse guardian secret key");
        Self { guardian_secret_key }
    }
}

pub struct CctpTokenBurnMessage {
    pub destination_cctp_domain: u32,
    pub cctp_message: CctpMessage,
    pub encoded_cctp_burn_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
}

pub struct CctpMessageHeader {
    pub version: u32,
    pub source_domain: u32,
    pub destination_domain: u32,
    pub nonce: u64,
    pub sender: [u8; 32],
    pub recipient: [u8; 32],
    pub destination_caller: [u8; 32],
}

impl CctpMessageHeader {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(116);
        buf[0..4].copy_from_slice(&self.version.to_be_bytes());
        buf[4..8].copy_from_slice(&self.source_domain.to_be_bytes());
        buf[8..12].copy_from_slice(&self.destination_domain.to_be_bytes());
        buf[12..20].copy_from_slice(&self.nonce.to_be_bytes());
        buf[20..52].copy_from_slice(&self.sender);
        buf[52..84].copy_from_slice(&self.recipient);
        buf[84..116].copy_from_slice(&self.destination_caller);
        buf
    }
}


pub struct CctpMessageBody {
    pub version: u32,
    pub burn_token_address: [u8; 32],
    pub mint_recipient: [u8; 32],
    pub amount: [u8; 32], // EVM amount as uint256 now in big endian byte format
    pub message_sender: [u8; 32],
}

impl CctpMessageBody {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(132);
        buf[0..4].copy_from_slice(&self.version.to_be_bytes());
        buf[4..36].copy_from_slice(&self.burn_token_address);
        buf[36..68].copy_from_slice(&self.mint_recipient);
        buf[68..100].copy_from_slice(&self.amount);
        buf[100..132].copy_from_slice(&self.message_sender);
        buf
    }
}
impl From<&BurnMessage<'_>> for CctpMessageBody {

    fn from(value: &BurnMessage) -> Self {
        Self { version: value.version().expect("Version not found"), burn_token_address: value.burn_token().expect("Burn token address not found").to_bytes(), mint_recipient: value.mint_recipient().expect("Mint recipient not found").to_bytes(), amount: to_uint256_bytes(value.amount().expect("Amount not found")), message_sender: value.message_sender().expect("Message sender not found").to_bytes() }
    }

}

fn to_uint256_bytes(amount: u64) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[32-8..].copy_from_slice(&amount.to_be_bytes());
    buf
}

pub struct CctpMessage {
    pub header: CctpMessageHeader,
    pub body: CctpMessageBody,
}

impl CctpMessage {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(116 + 132);
        buf[0..116].copy_from_slice(&self.header.encode());
        buf[116..].copy_from_slice(&self.body.encode());
        buf
    }
}


pub async fn craft_cctp_token_burn_message(
    test_ctx: &Rc<RefCell<ProgramTestContext>>,
    source_cctp_domain: u32,
    cctp_nonce: u64,
    amount: u64, // Only allows for 8 byte amounts for now. If we want larger amount support, we can change this to uint256.
    message_transmitter_config_pubkey: &Pubkey,
    remote_token_messenger_pubkey: &Pubkey,
    cctp_mint_recipient: &Pubkey,
    custodian_address: &Pubkey,
) -> Result<CctpTokenBurnMessage> {
    let destination_cctp_domain =  CHAIN_TO_DOMAIN[Chain::Solana as usize].1; // Hard code solana as destination domain
    assert_eq!(destination_cctp_domain, 5);
    let message_transmitter_config_data = test_ctx.borrow_mut().banks_client.get_account(*message_transmitter_config_pubkey).await.expect("Failed to fetch account").expect("Account not found").data;
    let message_transmitter_config = MessageTransmitterConfig::try_deserialize(&mut &message_transmitter_config_data[..]).expect("Failed to deserialize message transmitter config");
    let cctp_header_version = message_transmitter_config.version;
    let local_domain = message_transmitter_config.local_domain;
    assert_eq!(local_domain, destination_cctp_domain);
    let remote_token_messenger_data = test_ctx.borrow_mut().banks_client.get_account(*remote_token_messenger_pubkey).await.expect("Failed to fetch account").expect("Account not found").data;
    let remote_token_messenger = CctpRemoteTokenMessenger::try_deserialize(&mut &remote_token_messenger_data[..]).expect("Could not deserialize remote token messenger");
    let source_token_messenger = remote_token_messenger.token_messenger;
    let burn_token_address = ethereum_address_to_universal(ETHEREUM_USDC_ADDRESS);
    
    let burn_message_vec = BurnMessage::format_message(
        0,
        &Pubkey::try_from_slice(&burn_token_address).unwrap(),
        &cctp_mint_recipient,
        amount,
        &Pubkey::try_from_slice(&[0u8; 32]).unwrap(),
    )?;

    let burn_message = BurnMessage::new(0, &burn_message_vec).unwrap();

    let cctp_message_body = CctpMessageBody::from(&burn_message);

    let cctp_message_header = CctpMessageHeader {
        version: cctp_header_version,
        source_domain: source_cctp_domain,
        destination_domain: destination_cctp_domain,
        nonce: cctp_nonce,
        sender: source_token_messenger.to_bytes(),
        recipient: TOKEN_MESSENGER_MINTER_PROGRAM_ID.to_bytes(),
        destination_caller: custodian_address.to_bytes(),
    };

    assert_eq!(cctp_message_body.encode().len(), burn_message_vec.len(), "CCTP message body length mismatch");
    assert_eq!(cctp_message_body.encode(), burn_message_vec, "CCTP message body mismatch");

    let cctp_message = CctpMessage {
        header: cctp_message_header,
        body: cctp_message_body,
    };

    let encoded_cctp_message = cctp_message.encode();

    let cctp_attestation = CircleAttester::default().create_attestation(&encoded_cctp_message);
    
    Ok(CctpTokenBurnMessage {
        destination_cctp_domain,
        cctp_message,
        encoded_cctp_burn_message: encoded_cctp_message,
        cctp_attestation: cctp_attestation.to_vec(),
    })
}

pub fn ethereum_address_to_universal(eth_address: &str) -> [u8; 32] {
    // Remove '0x' prefix if present
    let address_str = eth_address.strip_prefix("0x").unwrap_or(eth_address);
    
    // Decode the hex string to bytes
    let mut address_bytes = [0u8; 20]; // Ethereum addresses are 20 bytes
    hex::decode_to_slice(address_str, &mut address_bytes as &mut [u8])
        .expect("Invalid Ethereum address format");
    
    // Create a 32-byte array with leading zeros (Ethereum addresses are padded with zeros on the left)
    let mut universal_address = [0u8; 32];
    universal_address[12..32].copy_from_slice(&address_bytes);
    
    universal_address
}