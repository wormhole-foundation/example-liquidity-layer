use anchor_lang::prelude::*;

#[error_code]
pub enum UpgradeManagerError {
    #[msg("AlreadyUpgraded")]
    AlreadyUpgraded = 0x10,

    #[msg("NotUpgraded")]
    NotUpgraded = 0x11,

    #[msg("ProgramDataMismatch")]
    ProgramDataMismatch = 0x12,

    #[msg("InvalidBuffer")]
    InvalidBuffer = 0x14,

    #[msg("CanMigrate")]
    CanMigrate = 0x20,
}
