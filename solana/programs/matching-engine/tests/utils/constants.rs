use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;

// Program IDs
pub const CORE_BRIDGE_PID: Pubkey = solana_program::pubkey!("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth");
pub const TOKEN_ROUTER_PID: Pubkey = solana_program::pubkey!("tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md");
pub const CCTP_TOKEN_MESSENGER_MINTER_PID: Pubkey = solana_program::pubkey!("CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3");
pub const CCTP_MESSAGE_TRANSMITTER_PID: Pubkey = solana_program::pubkey!("CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd");

/// Keypairs as base64 strings (taken from consts.ts in ts tests)
// pub const PAYER_KEYPAIR_B64: &str = "cDfpY+VbRFXPPwouZwAx+ha9HqedkhqUr5vUaFa2ucAMGliG/hCT35/EOMKW+fcnW3cYtrwOFW2NM2xY8IOZbQ==";
// pub const OWNER_ASSISTANT_KEYPAIR_B64: &str = "900mlHo1RRdhxUKuBnnPowQ7yqb4rJ1dC7K1PM+pRxeuCWamoSkQdY+3hXAeX0OBXanyqg4oyBl8g1z1sDnSWg==";
// pub const OWNER_KEYPAIR_B64: &str = "t0zuiHtsaDJBSUFzkvXNttgXOMvZy0bbuUPGEByIJEHAUdFeBdSAesMbgbuH1v/y+B8CdTSkCIZZNuCntHQ+Ig==";
// pub const PLAYER_ONE_KEYPAIR_B64: &str = "4STrqllKVVva0Fphqyf++6uGTVReATBe2cI26oIuVBft77CQP9qQrMTU1nM9ql0EnCpSgmCmm20m8khMo9WdPQ==";

/// Keypairs as base58 strings (taken from consts.ts in ts tests using a converter)
#[allow(dead_code)]
pub const PAYER_KEYPAIR_B58: &str = "4NMwxzmYj2uvHuq8xoqhY8RXg0Pd5zkvmfWAL6YvbYFuViXVCBDK5Pru9GgqEVEZo6UXcPVH6rdR8JKgKxHGkXDp";
#[allow(dead_code)]
pub const OWNER_ASSISTANT_KEYPAIR_B58: &str = "2UbUgoidcNHxVEDG6ADNKGaGDqBTXTVw6B9pWvJtLNhbxcQDkdeEyBYBYYYxxDy92ckXUEaU9chWEGi5jc8Uc9e3";
#[allow(dead_code)]
pub const OWNER_KEYPAIR_B58: &str = "3M5rkG5DQVEGQFRtA1qruxPqJvYBbkGCdkCdB9ZjcnQnYL9ec8W78pLcQHVtjJzHP8phUXQ8V1SXbgZK9ZaFaS6U";
#[allow(dead_code)]
pub const PLAYER_ONE_KEYPAIR_B58: &str = "yqJrKqGqzuW6nEmfj62AgvZWqgGv9TqxfvPXiGvf8DxGDWz3UNkQdDfKDnBYpHQxPRVrYMupDKqbGVYHhfZApGb";

// Helper functions to get keypairs
#[allow(dead_code)]
pub fn get_payer_keypair() -> Keypair {
    Keypair::from_base58_string(PAYER_KEYPAIR_B58)
}

#[allow(dead_code)]
pub fn get_owner_assistant_keypair() -> Keypair {
    Keypair::from_base58_string(OWNER_ASSISTANT_KEYPAIR_B58)
}

#[allow(dead_code)]
pub fn get_owner_keypair() -> Keypair {
    Keypair::from_base58_string(OWNER_KEYPAIR_B58)
}

#[allow(dead_code)]
pub fn get_player_one_keypair() -> Keypair {
    Keypair::from_base58_string(PLAYER_ONE_KEYPAIR_B58)
}

// TODO: Remove these constants if not ever used
// Other constants
#[allow(dead_code)]
pub const GOVERNANCE_EMITTER_ADDRESS: Pubkey = solana_program::pubkey!("11111111111111111111111111111115");
#[allow(dead_code)]
pub const GUARDIAN_KEY: &str = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
#[allow(dead_code)]
pub const USDC_MINT_ADDRESS: Pubkey = solana_program::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
#[allow(dead_code)]
pub const ETHEREUM_USDC_ADDRESS: &str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// Chain to cctp domain mapping
pub const CHAIN_TO_DOMAIN: &[(Chain, u32)] = &[
    (Chain::Ethereum, 0),
    (Chain::Avalanche, 1),
    (Chain::Optimism, 2),
    (Chain::Arbitrum, 3),
    (Chain::Solana, 5),
    (Chain::Base, 6),
    (Chain::Polygon, 7),
];

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
    pub fn to_chain_id(&self) -> u16 {
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

