use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Copy)]
pub enum UpgradeStatus {
    None,
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
