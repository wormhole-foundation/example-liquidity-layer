use anchor_lang::prelude::*;

/// Current state of an upgrade.
#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Copy)]
pub enum UpgradeStatus {
    /// No status set.
    None,
    /// An upgrade has been executed, but not committed.
    Uncommitted { buffer: Pubkey, slot: u64 },
}

impl std::fmt::Display for UpgradeStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpgradeStatus::None => write!(f, "None"),
            UpgradeStatus::Uncommitted { buffer, slot } => {
                write!(f, "Uncommitted {{ buffer: {}, slot: {} }}", buffer, slot)
            }
        }
    }
}

/// An account which reflects the status of an upgrade after one has been executed. This account
/// will only exist when an upgrade status is uncommitted.
///
/// NOTE: Please be careful with modifying the schema of this account. If you upgrade a program
/// without committing, and follow it with an Upgrade Manager program upgrade with a new receipt
/// serialization, you will have a bad time.
#[account]
#[derive(Debug, InitSpace)]
pub struct UpgradeReceipt {
    pub bump: u8,
    pub program_data_bump: u8,

    pub owner: Pubkey,
    pub status: UpgradeStatus,
}

impl UpgradeReceipt {
    pub const SEED_PREFIX: &'static [u8] = b"receipt";
}
