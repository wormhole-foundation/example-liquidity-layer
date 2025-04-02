#![allow(dead_code)]

//! # Constants
//!
//! This module contains constants for the matching engine testing module.
//!
//! ## Exposed constants
//!
//! - `CORE_BRIDGE_PID` - The program ID of the core bridge
//! - `CORE_BRIDGE_FEE_COLLECTOR` - The fee collector of the core bridge
//! - `CORE_BRIDGE_CONFIG` - The config of the core bridge
//! - `TOKEN_BRIDGE_PID` - The program ID of the token bridge
//! - `TOKEN_BRIDGE_EMITTER_AUTHORITY` - The emitter authority of the token bridge
//! - `TOKEN_BRIDGE_CUSTODY_AUTHORITY` - The custody authority of the token bridge
//! - `TOKEN_BRIDGE_MINT_AUTHORITY` - The mint authority of the token bridge
//! - `TOKEN_BRIDGE_TRANSFER_AUTHORITY` - The transfer authority of the token bridge
//! - `USDC_MINT` - The mint address of USDC
//! - `GUARDIAN_SECRET_KEY` - The guardian secret key
//! - `TOKEN_ROUTER_PID` - The program ID of the token router
//! - `CCTP_TOKEN_MESSENGER_MINTER_PID` - The program ID of the CCTP token messenger minter
//! - `CCTP_MESSAGE_TRANSMITTER_PID` - The program ID of the CCTP message transmitter
//! - `WORMHOLE_POST_MESSAGE_SHIM_PID` - The program ID of the Wormhole post message shim
//! - `WORMHOLE_VERIFY_VAA_SHIM_PID` - The program ID of the Wormhole verify VAA shim
//! - `WORMHOLE_POST_MESSAGE_SHIM_EVENT_AUTHORITY` - The event authority of the Wormhole post message shim
//!
//! ## Enums
//!
//! - `Chain` - An enum representing the different chains. Chain implements `as_cctp_domain` to get the CCTP domain for the chain.
//!
//! ## Examples
//!
//! ```rust
//! use crate::constants::*;
//! let eth_cctp_domain = Chain::Ethereum.as_cctp_domain();
//! ```

use solana_program::pubkey;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;

// Program IDs
cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        /// Core Bridge program ID on Solana mainnet.
        pub const CORE_BRIDGE_PID: Pubkey = pubkey!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
        pub const CORE_BRIDGE_FEE_COLLECTOR: Pubkey = pubkey!("9bFNrXNb2WTx8fMHXCheaZqkLZ3YCCaiqTftHxeintHy");
        pub const CORE_BRIDGE_CONFIG: Pubkey = pubkey!("2yVjuQwpsvdsrywzsJJVs9Ueh4zayyo5DYJbBNc3DDpn");

        /// Token Bridge program ID on Solana mainnet.
        pub const TOKEN_BRIDGE_PID: Pubkey = pubkey!("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");
        pub const TOKEN_BRIDGE_EMITTER_AUTHORITY: Pubkey = pubkey!("Gv1KWf8DT1jKv5pKBmGaTmVszqa56Xn8YGx2Pg7i7qAk");
        pub const TOKEN_BRIDGE_CUSTODY_AUTHORITY: Pubkey = pubkey!("GugU1tP7doLeTw9hQP51xRJyS8Da1fWxuiy2rVrnMD2m");
        pub const TOKEN_BRIDGE_MINT_AUTHORITY: Pubkey = pubkey!("BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7");
        pub const TOKEN_BRIDGE_TRANSFER_AUTHORITY: Pubkey = pubkey!("7oPa2PHQdZmjSPqvpZN7MQxnC7Dcf3uL4oLqknGLk2S3");

        /// USDC mint address found on Solana mainnet.
        pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    } else if #[cfg(feature = "testnet")] {
        /// Core Bridge program ID on Solana devnet.
        pub const CORE_BRIDGE_PID: Pubkey = pubkey!("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
        pub const CORE_BRIDGE_FEE_COLLECTOR: Pubkey = pubkey!("7s3a1ycs16d6SNDumaRtjcoyMaTDZPavzgsmS3uUZYWX");
        pub const CORE_BRIDGE_CONFIG: Pubkey = pubkey!("6bi4JGDoRwUs9TYBuvoA7dUVyikTJDrJsJU1ew6KVLiu");

        /// Token Bridge program ID on Solana devnet.
        pub const TOKEN_BRIDGE_PID: Pubkey = pubkey!("DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe");
        pub const TOKEN_BRIDGE_EMITTER_AUTHORITY: Pubkey = pubkey!("4yttKWzRoNYS2HekxDfcZYmfQqnVWpKiJ8eydYRuFRgs");
        pub const TOKEN_BRIDGE_CUSTODY_AUTHORITY: Pubkey = pubkey!("H9pUTqZoRyFdaedRezhykA1aTMq7vbqRHYVhpHZK2QbC");
        pub const TOKEN_BRIDGE_MINT_AUTHORITY: Pubkey = pubkey!("rRsXLHe7sBHdyKU3KY3wbcgWvoT1Ntqudf6e9PKusgb");
        pub const TOKEN_BRIDGE_TRANSFER_AUTHORITY: Pubkey = pubkey!("3VFdJkFuzrcwCwdxhKRETGxrDtUVAipNmYcLvRBDcQeH");

        /// USDC mint address found on Solana devnet.
        pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    } else if #[cfg(feature = "localnet")] {
        /// Core Bridge program ID on Wormhole's Tilt (dev) network.
        pub const CORE_BRIDGE_PID: Pubkey = pubkey!("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o");
        pub const CORE_BRIDGE_FEE_COLLECTOR: Pubkey = pubkey!("GXBsgBD3LDn3vkRZF6TfY5RqgajVZ4W5bMAdiAaaUARs");
        pub const CORE_BRIDGE_CONFIG: Pubkey = pubkey!("FKoMTctsC7vJbEqyRiiPskPnuQx2tX1kurmvWByq5uZP");

        /// Token Bridge program ID on Wormhole's Tilt (dev) network.
        pub const TOKEN_BRIDGE_PID: Pubkey = pubkey!("B6RHG3mfcckmrYN1UhmJzyS1XX3fZKbkeUcpJe9Sy3FE");
        pub const TOKEN_BRIDGE_EMITTER_AUTHORITY: Pubkey = pubkey!("ENG1wQ7CQKH8ibAJ1hSLmJgL9Ucg6DRDbj752ZAfidLA");
        pub const TOKEN_BRIDGE_CUSTODY_AUTHORITY: Pubkey = pubkey!("JCQ1JdJ3vgnvurNAqMvpwaiSwJXaoMFJN53F6sRKejxQ");
        pub const TOKEN_BRIDGE_MINT_AUTHORITY: Pubkey = pubkey!("8P2wAnHr2t4pAVEyJftzz7k6wuCE7aP1VugNwehzCJJY");
        pub const TOKEN_BRIDGE_TRANSFER_AUTHORITY: Pubkey = pubkey!("C1AVBd8PpfHGe1zW42XXVbHsAQf6q5khiRKuGPLbwHkh");

        /// USDC mint address found on Solana devnet.
        ///
        /// NOTE: We expect an integrator to load this account by pulling it from Solana devnet.
        pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    }
}

pub const GUARDIAN_SECRET_KEY: &str =
    "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
pub const TOKEN_ROUTER_PID: Pubkey =
    solana_program::pubkey!("tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md");
pub const CCTP_TOKEN_MESSENGER_MINTER_PID: Pubkey =
    solana_program::pubkey!("CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3");
pub const CCTP_MESSAGE_TRANSMITTER_PID: Pubkey =
    solana_program::pubkey!("CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd");
pub const WORMHOLE_POST_MESSAGE_SHIM_PID: Pubkey =
    pubkey!("EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX");
pub const WORMHOLE_VERIFY_VAA_SHIM_PID: Pubkey =
    pubkey!("EFaNWErqAtVWufdNb7yofSHHfWFos843DFpu4JBw24at");
pub const WORMHOLE_POST_MESSAGE_SHIM_EVENT_AUTHORITY: Pubkey =
    pubkey!("HQS31aApX3DDkuXgSpV9XyDUNtFgQ31pUn5BNWHG2PSp");
pub const WORMHOLE_POST_MESSAGE_SHIM_EVENT_AUTHORITY_BUMP: u8 = 255;

/// Keypairs as base64 strings (taken from consts.ts in ts tests)
// pub const PAYER_KEYPAIR_B64: &str = "cDfpY+VbRFXPPwouZwAx+ha9HqedkhqUr5vUaFa2ucAMGliG/hCT35/EOMKW+fcnW3cYtrwOFW2NM2xY8IOZbQ==";
// pub const OWNER_ASSISTANT_KEYPAIR_B64: &str = "900mlHo1RRdhxUKuBnnPowQ7yqb4rJ1dC7K1PM+pRxeuCWamoSkQdY+3hXAeX0OBXanyqg4oyBl8g1z1sDnSWg==";
// pub const OWNER_KEYPAIR_B64: &str = "t0zuiHtsaDJBSUFzkvXNttgXOMvZy0bbuUPGEByIJEHAUdFeBdSAesMbgbuH1v/y+B8CdTSkCIZZNuCntHQ+Ig==";
// pub const PLAYER_ONE_KEYPAIR_B64: &str = "4STrqllKVVva0Fphqyf++6uGTVReATBe2cI26oIuVBft77CQP9qQrMTU1nM9ql0EnCpSgmCmm20m8khMo9WdPQ==";

/// Keypairs as base58 strings (taken from consts.ts in ts tests using a converter)
pub const PAYER_KEYPAIR_B58: &str =
    "4NMwxzmYj2uvHuq8xoqhY8RXg0Pd5zkvmfWAL6YvbYFuViXVCBDK5Pru9GgqEVEZo6UXcPVH6rdR8JKgKxHGkXDp";
pub const OWNER_ASSISTANT_KEYPAIR_B58: &str =
    "2UbUgoidcNHxVEDG6ADNKGaGDqBTXTVw6B9pWvJtLNhbxcQDkdeEyBYBYYYxxDy92ckXUEaU9chWEGi5jc8Uc9e3";
pub const OWNER_KEYPAIR_B58: &str =
    "3M5rkG5DQVEGQFRtA1qruxPqJvYBbkGCdkCdB9ZjcnQnYL9ec8W78pLcQHVtjJzHP8phUXQ8V1SXbgZK9ZaFaS6U";
pub const PLAYER_ONE_KEYPAIR_B58: &str =
    "yqJrKqGqzuW6nEmfj62AgvZWqgGv9TqxfvPXiGvf8DxGDWz3UNkQdDfKDnBYpHQxPRVrYMupDKqbGVYHhfZApGb";

// Helper functions to get keypairs
pub fn get_payer_keypair() -> Keypair {
    Keypair::from_base58_string(PAYER_KEYPAIR_B58)
}

pub fn get_owner_assistant_keypair() -> Keypair {
    Keypair::from_base58_string(OWNER_ASSISTANT_KEYPAIR_B58)
}

pub fn get_owner_keypair() -> Keypair {
    Keypair::from_base58_string(OWNER_KEYPAIR_B58)
}

pub fn get_player_one_keypair() -> Keypair {
    Keypair::from_base58_string(PLAYER_ONE_KEYPAIR_B58)
}

pub const ETHEREUM_USDC_ADDRESS: &str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Enum for Chain types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Chain {
    Ethereum,
    Avalanche,
    Optimism,
    Arbitrum,
    Solana,
    Base,
    Polygon,
}

impl Chain {
    pub fn as_index(&self) -> usize {
        match self {
            Chain::Solana => 0,
            Chain::Ethereum => 1,
            Chain::Avalanche => 2,
            Chain::Optimism => 3,
            Chain::Arbitrum => 4,
            Chain::Base => 5,
            Chain::Polygon => 6,
        }
    }

    pub fn as_cctp_domain(&self) -> u32 {
        match self {
            Chain::Ethereum => 0,
            Chain::Avalanche => 1,
            Chain::Optimism => 2,
            Chain::Arbitrum => 3,
            Chain::Solana => 5,
            Chain::Base => 6,
            Chain::Polygon => 7,
        }
    }
}

// Registered Token Routers
lazy_static::lazy_static! {
    pub static ref REGISTERED_TOKEN_ROUTERS: std::collections::HashMap<Chain, Vec<u8>> = {
        let mut m = std::collections::HashMap::new();
        m.insert(Chain::Ethereum, vec![0xf0; 32]);
        m.insert(Chain::Avalanche, vec![0xf1; 32]);
        m.insert(Chain::Optimism, vec![0xf2; 32]);
        m.insert(Chain::Arbitrum, vec![0xf3; 32]);
        m.insert(Chain::Base, vec![0xf6; 32]);
        m.insert(Chain::Polygon, vec![0xf7; 32]);
        m
    };
}

// Chain ID mapping
impl Chain {
    pub fn as_chain_id(&self) -> u16 {
        match self {
            Chain::Solana => 1,
            Chain::Ethereum => 2,
            Chain::Avalanche => 6,
            Chain::Optimism => 24,
            Chain::Arbitrum => 23,
            Chain::Base => 30,
            Chain::Polygon => 5,
        }
    }
}
