pub use wormhole_cctp_solana;

pub mod admin;

pub use liquidity_layer_messages as messages;
pub use messages::wormhole_io;

pub const WORMHOLE_MESSAGE_NONCE: u32 = 0;

pub const CORE_MESSAGE_SEED_PREFIX: &[u8] = b"core-msg";
pub const CCTP_MESSAGE_SEED_PREFIX: &[u8] = b"cctp-msg";

pub const TRANSFER_AUTHORITY_SEED_PREFIX: &[u8] = b"transfer-authority";

pub use wormhole_solana_consts::USDC_MINT;

use solana_program::{pubkey, pubkey::Pubkey};

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        pub const UPGRADE_MANAGER_PROGRAM_ID: Pubkey = pubkey!("ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt");
        pub const UPGRADE_MANAGER_AUTHORITY: Pubkey = pubkey!("2sxpm9pvWmNWFzhgWtmxkMsdWk2uSNT9MoKvww53po1M");
    } else if #[cfg(feature = "localnet")] {
        pub const UPGRADE_MANAGER_PROGRAM_ID: Pubkey = pubkey!("UpgradeManager11111111111111111111111111111");
        pub const UPGRADE_MANAGER_AUTHORITY: Pubkey = pubkey!("9Nu3k9HKFChDcAC8SeCrCeHvsRcdZzZfdQxGaEynFHZ7");
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn upgrade_manager_authority() {
        let (expected, _) =
            Pubkey::find_program_address(&[b"upgrade"], &UPGRADE_MANAGER_PROGRAM_ID);
        assert_eq!(UPGRADE_MANAGER_AUTHORITY, expected);
    }
}
