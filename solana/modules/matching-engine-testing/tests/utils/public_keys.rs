//! # Public Keys
//!
//! This module provides a struct for representing public keys in the test environment.
//! It includes methods for converting between different key types and for creating unique keys.

use solana_sdk::{keccak, pubkey::Pubkey};

use super::{Chain, REGISTERED_TOKEN_ROUTERS};

pub trait ToBytes {
    fn to_bytes(&self) -> [u8; 32];
}

/// A struct representing a test public key
///
/// # Enums
///
/// * `solana` - A Solana public key
/// * `evm` - An EVM public key
/// * `bytes` - A bytes representation of the public key
///
/// # Methods
///
/// * `to_bytes` - Converts the public key to a bytes array
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
        let hex = hex.strip_prefix("0x").unwrap_or_else(|| hex);
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
        let (_secp_secret_key, secp_pubkey) =
            secp256k1::generate_keypair(&mut secp256k1::rand::rngs::OsRng);
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

/// A struct representing a chain and address
///
/// # Fields
///
/// * `chain` - The chain
/// * `address` - The address
#[derive(Clone)]
pub struct ChainAddress {
    pub chain: Chain,
    pub address: TestPubkey,
}

impl ChainAddress {
    #[allow(dead_code)]
    pub fn new_unique(chain: Chain) -> Self {
        match chain {
            Chain::Solana => Self {
                chain,
                address: TestPubkey::Solana(Pubkey::new_unique()),
            },
            Chain::Ethereum => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
            Chain::Arbitrum => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
            Chain::Avalanche => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
            Chain::Optimism => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
            Chain::Polygon => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
            Chain::Base => Self {
                chain,
                address: TestPubkey::Evm(EvmAddress::new_unique()),
            },
        }
    }

    #[allow(dead_code)]
    pub fn new_with_address(chain: Chain, address: [u8; 32]) -> Self {
        Self {
            chain,
            address: TestPubkey::Bytes(address),
        }
    }

    pub fn from_registered_token_router(chain: Chain) -> Self {
        match chain {
            Chain::Arbitrum => Self::new_with_address(
                chain,
                REGISTERED_TOKEN_ROUTERS[&chain].clone().try_into().unwrap(),
            ),
            Chain::Ethereum => Self::new_with_address(
                chain,
                REGISTERED_TOKEN_ROUTERS[&chain].clone().try_into().unwrap(),
            ),
            Chain::Solana => Self::new_with_address(
                chain,
                REGISTERED_TOKEN_ROUTERS[&chain].clone().try_into().unwrap(),
            ),
            _ => panic!("Unsupported chain"),
        }
    }
}
