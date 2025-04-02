use crate::utils::ETHEREUM_USDC_ADDRESS;
use anchor_lang::prelude::*;
use common::messages::raw::LiquidityLayerDepositMessage;
use common::wormhole_cctp_solana::cctp::{
    message_transmitter_program::MessageTransmitterConfig,
    token_messenger_minter_program::RemoteTokenMessenger,
};
use common::wormhole_cctp_solana::cctp::{
    MESSAGE_TRANSMITTER_PROGRAM_ID, TOKEN_MESSENGER_MINTER_PROGRAM_ID,
};
use common::wormhole_cctp_solana::messages::Deposit;
use matching_engine::state::FastMarketOrder;
use num_traits::FromBytes;
use ruint::Uint;
use secp256k1::SecretKey as SecpSecretKey;
use solana_program::keccak::{Hash, Hasher};
use solana_program_test::ProgramTestContext;
use solana_sdk::keccak;
use std::fmt::Display;
use std::str::FromStr;

use super::{Chain, GUARDIAN_SECRET_KEY};

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

// Imported from https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/token-messenger-minter/src/token_messenger/state.rs#L35-L38
#[derive(Debug, InitSpace)]
pub struct CctpRemoteTokenMessenger {
    pub domain: u32, // Big endian
    pub token_messenger: Pubkey,
}

impl From<&RemoteTokenMessenger> for CctpRemoteTokenMessenger {
    fn from(value: &RemoteTokenMessenger) -> Self {
        Self {
            domain: value.domain,
            token_messenger: Pubkey::from(value.token_messenger),
        }
    }
}

// Imported from https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/message-transmitter/src/message.rs#L30
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

#[allow(dead_code)]
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
        require_gte!(message_bytes.len(), Self::MESSAGE_BODY_INDEX);
        let message = Self {
            data: message_bytes,
        };
        require_eq!(expected_version, message.version()?,);
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
        Ok(
            Pubkey::try_from(&self.data[index..checked_add(index, std::mem::size_of::<Pubkey>())?])
                .map_err(|_| MessageTransmitterError::MalformedMessage)?,
        )
    }
}

// Imported from https://github.com/circlefin/solana-cctp-contracts/blob/4477f889732209dfc9a08b3aeaeb9203a324055c/programs/token-messenger-minter/src/token_messenger/burn_message.rs#L26
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

    /// Validates source array size and returns a new message
    pub fn new(message_bytes: &'a [u8]) -> Result<Self> {
        require_eq!(
            message_bytes.len(),
            Self::BURN_MESSAGE_LEN,
            TokenMessengerError::MalformedMessage
        );
        let message = Self {
            data: message_bytes,
        };

        Ok(message)
    }

    #[allow(clippy::too_many_arguments)]
    /// Serializes given fields into a burn message
    pub fn format_message(
        version: u32,
        burn_token: &Pubkey,
        mint_recipient: &Pubkey,
        amount: Uint<256, 4>,
        message_sender: &Pubkey,
    ) -> Result<Vec<u8>> {
        let mut output = vec![0; Self::BURN_MESSAGE_LEN];

        output[Self::VERSION_INDEX..Self::BURN_TOKEN_INDEX].copy_from_slice(&version.to_be_bytes());
        output[Self::BURN_TOKEN_INDEX..Self::MINT_RECIPIENT_INDEX]
            .copy_from_slice(burn_token.as_ref());
        output[Self::MINT_RECIPIENT_INDEX..Self::AMOUNT_INDEX]
            .copy_from_slice(mint_recipient.as_ref());
        output[Self::AMOUNT_INDEX..Self::MSG_SENDER_INDEX]
            .copy_from_slice(&amount.to_be_bytes::<32>());
        output[Self::MSG_SENDER_INDEX..Self::BURN_MESSAGE_LEN]
            .copy_from_slice(message_sender.as_ref());

        Ok(output)
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
    pub fn amount(&self) -> Result<Uint<256, 4>> {
        Ok(Uint::from_be_bytes::<32>(
            self.data[Self::AMOUNT_INDEX..Self::AMOUNT_INDEX + 32]
                .try_into()
                .unwrap(),
        ))
    }

    /// Returns message_sender field
    pub fn message_sender(&self) -> Result<Pubkey> {
        self.read_pubkey(Self::MSG_SENDER_INDEX)
    }

    ////////////////////
    // private helpers

    /// Reads pubkey field at the given offset
    fn read_pubkey(&self, index: usize) -> Result<Pubkey> {
        Ok(
            Pubkey::try_from(&self.data[index..checked_add(index, std::mem::size_of::<Pubkey>())?])
                .map_err(|_| TokenMessengerError::MalformedMessage)?,
        )
    }
}

pub struct CircleAttester {
    // Default implements this to be the guardian key from file
    guardian_secret_key: SecpSecretKey,
}

impl CircleAttester {
    /// Creates an attestation for a given message
    ///
    /// # Arguments
    ///
    /// * `message` - The message to attest to
    ///
    /// # Returns
    ///
    /// A 65 byte array containing the attestation and the recovery id in the last byte
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
        let recovery_id_try = u8::try_from(i32::from(recovery_id)).unwrap();
        let recovery_id_true = if recovery_id_try < 27 {
            recovery_id_try.saturating_add(27)
        } else {
            recovery_id_try
        };
        signature_bytes[64] = recovery_id_true; // This is only ever 0..4
        signature_bytes
    }
}

impl Default for CircleAttester {
    fn default() -> Self {
        let guardian_secret_key = secp256k1::SecretKey::from_str(GUARDIAN_SECRET_KEY)
            .expect("Failed to parse guardian secret key");
        Self {
            guardian_secret_key,
        }
    }
}

/// A struct representing a CCTP token burn message
///
/// # Fields
///
/// * `destination_cctp_domain` - The destination CCTP domain
/// * `cctp_message` - The CCTP message
/// * `encoded_cctp_burn_message` - The encoded CCTP burn message
/// * `cctp_attestation` - The CCTP attestation
pub struct CctpTokenBurnMessage {
    pub destination_cctp_domain: u32,
    pub cctp_message: CctpMessage,
    pub encoded_cctp_burn_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
}

impl CctpTokenBurnMessage {
    pub fn verify_cctp_message(&self, fast_market_order: &FastMarketOrder) -> Result<()> {
        self.cctp_message.body.verify(fast_market_order)?;
        self.cctp_message.header.verify(fast_market_order)?;
        Ok(())
    }
}

/// A struct representing a CCTP message header
///
/// # Fields
///
/// * `version` - The version of the CCTP message
/// * `source_domain` - The source CCTP domain
/// * `destination_domain` - The destination CCTP domain
/// * `nonce` - The nonce of the CCTP message
/// * `sender` - The sender of the CCTP message
/// * `recipient` - The recipient of the CCTP message
/// * `destination_caller` - The destination caller of the CCTP message
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
        buf.extend_from_slice(&self.version.to_be_bytes());
        buf.extend_from_slice(&self.source_domain.to_be_bytes());
        buf.extend_from_slice(&self.destination_domain.to_be_bytes());
        buf.extend_from_slice(&self.nonce.to_be_bytes());
        buf.extend_from_slice(&self.sender);
        buf.extend_from_slice(&self.recipient);
        buf.extend_from_slice(&self.destination_caller);
        assert_eq!(buf.len(), 116, "Cctp message header length mismatch");
        buf
    }

    // TODO: Add actual checks or remove if not needed
    pub fn verify(&self, _fast_market_order: &FastMarketOrder) -> Result<()> {
        Ok(())
    }
}

/// A struct representing a CCTP message body
///
/// # Fields
///
/// * `version` - The version of the CCTP message
/// * `burn_token_address` - The address of the token to burn
/// * `mint_recipient` - The address of the recipient of the token
/// * `amount` - The amount of the token to burn
/// * `message_sender` - The address of the sender of the message
pub struct CctpMessageBody {
    pub version: u32,
    pub burn_token_address: [u8; 32],
    pub mint_recipient: [u8; 32],
    pub amount: Uint<256, 4>, // EVM amount as uint256 now in big endian byte format
    pub message_sender: [u8; 32],
}

impl CctpMessageBody {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(132);
        buf.extend_from_slice(&self.version.to_be_bytes());
        buf.extend_from_slice(&self.burn_token_address);
        buf.extend_from_slice(&self.mint_recipient);
        buf.extend_from_slice(&self.amount.to_be_bytes::<32>());
        buf.extend_from_slice(&self.message_sender);
        assert_eq!(buf.len(), 132, "Cctp message body length mismatch");
        buf
    }

    pub fn verify(&self, fast_market_order: &FastMarketOrder) -> Result<()> {
        assert_eq!(
            fast_market_order.amount_in,
            self.amount.as_limbs()[0], // Since it is be encoded, the first limb will contain the u64 amount
            "Cctp message amount mismatch"
        );
        Ok(())
    }
}
impl From<&BurnMessage<'_>> for CctpMessageBody {
    fn from(value: &BurnMessage) -> Self {
        Self {
            version: 0,
            burn_token_address: value
                .burn_token()
                .expect("Burn token address not found")
                .to_bytes(),
            mint_recipient: value
                .mint_recipient()
                .expect("Mint recipient not found")
                .to_bytes(),
            amount: value.amount().expect("Amount not found"),
            message_sender: value
                .message_sender()
                .expect("Message sender not found")
                .to_bytes(),
        }
    }
}

/// A struct representing a CCTP message
///
/// # Fields
///
/// * `header` - The header of the CCTP message
/// * `body` - The body of the CCTP message
pub struct CctpMessage {
    pub header: CctpMessageHeader,
    pub body: CctpMessageBody,
}

impl CctpMessage {
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(116 + 132);
        buf.extend_from_slice(&self.header.encode());
        buf.extend_from_slice(&self.body.encode());
        assert_eq!(buf.len(), 116 + 132, "Cctp message length mismatch");
        buf
    }
}

/// Crafts a CCTP token burn message
///
/// # Arguments
///
/// * `test_context` - The test context
/// * `source_cctp_domain` - The source CCTP domain
/// * `cctp_nonce` - The nonce of the CCTP message
/// * `amount` - The amount of the token to burn
/// * `message_transmitter_config_pubkey` - The pubkey of the message transmitter config
/// * `remote_token_messenger` - The remote token messenger
/// * `cctp_mint_recipient` - The address of the recipient of the token
/// * `custodian_address` - The address of the custodian
#[allow(clippy::too_many_arguments)]
pub async fn craft_cctp_token_burn_message(
    test_context: &mut ProgramTestContext,
    source_cctp_domain: u32,
    cctp_nonce: u64,
    amount: Uint<256, 4>, // Only allows for 8 byte amounts for now. If we want larger amount support, we can change this to uint256.
    message_transmitter_config_pubkey: &Pubkey,
    remote_token_messenger: &CctpRemoteTokenMessenger,
    cctp_mint_recipient: &Pubkey,
    custodian_address: &Pubkey,
) -> Result<CctpTokenBurnMessage> {
    let destination_cctp_domain = Chain::Solana.as_cctp_domain(); // Hard code solana as destination domain
    assert_eq!(destination_cctp_domain, 5);
    let message_transmitter_config_data = test_context
        .banks_client
        .get_account(*message_transmitter_config_pubkey)
        .await
        .expect("Failed to fetch account")
        .expect("Account not found")
        .data;
    let message_transmitter_config =
        MessageTransmitterConfig::try_deserialize(&mut &message_transmitter_config_data[..])
            .expect("Failed to deserialize message transmitter config");
    let cctp_header_version = message_transmitter_config.version;
    let local_domain = message_transmitter_config.local_domain;
    assert_eq!(local_domain, destination_cctp_domain);
    let source_token_messenger = remote_token_messenger.token_messenger;
    let burn_token_address = ethereum_address_to_universal(ETHEREUM_USDC_ADDRESS);
    let burn_message_vec = BurnMessage::format_message(
        0,
        &Pubkey::try_from_slice(&burn_token_address).unwrap(),
        cctp_mint_recipient,
        amount,
        &Pubkey::try_from_slice(&[0u8; 32]).unwrap(),
    )?;

    let burn_message = BurnMessage::new(&burn_message_vec).unwrap();

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
    assert_eq!(
        cctp_message_body.encode().len(),
        burn_message_vec.len(),
        "CCTP message body length mismatch"
    );
    assert_eq!(
        cctp_message_body.encode(),
        burn_message_vec,
        "CCTP message body mismatch"
    );

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

/// Converts an Ethereum address to a wormhole universal address
///
/// # Arguments
///
/// * `eth_address` - The Ethereum address to convert
///
/// # Returns
///
/// A 32-byte array containing the universal address
pub fn ethereum_address_to_universal(eth_address: &str) -> [u8; 32] {
    // Remove '0x' prefix if present
    let address_str = eth_address
        .strip_prefix("0x")
        .unwrap_or_else(|| eth_address);

    // Decode the hex string to bytes
    let mut address_bytes = [0u8; 20]; // Ethereum addresses are 20 bytes
    hex::decode_to_slice(address_str, &mut address_bytes).expect("Invalid Ethereum address format");

    // Create a 32-byte array with leading zeros (Ethereum addresses are padded with zeros on the left)
    let mut universal_address = [0u8; 32];
    universal_address[12..32].copy_from_slice(&address_bytes);

    universal_address
}

/// Gets the base fee for a deposit
///
/// # Arguments
///
/// * `deposit` - The deposit to get the base fee for
///
/// # Returns
///
/// The base fee for the deposit
pub fn get_deposit_base_fee(deposit: &Deposit) -> u64 {
    let payload = deposit.payload.clone();
    let liquidity_layer_message = LiquidityLayerDepositMessage::parse(&payload).unwrap();
    let slow_order_response = liquidity_layer_message
        .slow_order_response()
        .expect("Failed to get slow order response");
    slow_order_response.base_fee()
}

pub struct UsedNonces;

impl UsedNonces {
    pub const MAX_NONCES: u64 = 6400;
    pub fn address(remote_domain: u32, nonce: u64) -> (Pubkey, u8) {
        let first_nonce = if nonce == 0 {
            0
        } else {
            (nonce.saturating_sub(1))
                .saturating_div(Self::MAX_NONCES)
                .saturating_mul(Self::MAX_NONCES)
                .saturating_add(1)
        }; // Could potentially use a more efficient algorithm, but this finds the first nonce in a bucket
        let remote_domain_converted = remote_domain.to_string();
        let first_nonce_converted = first_nonce.to_string();
        Pubkey::find_program_address(
            &[
                b"used_nonces",
                remote_domain_converted.as_bytes(),
                first_nonce_converted.as_bytes(),
            ],
            &MESSAGE_TRANSMITTER_PROGRAM_ID,
        )
    }
}

/// A struct representing a decoded CCTP message
///
/// # Fields
///
/// * `nonce` - The nonce of the CCTP message
/// * `source_domain` - The source CCTP domain
#[derive(Debug)]
pub struct CctpMessageDecoded {
    pub nonce: u64,
    pub source_domain: u32,
}
