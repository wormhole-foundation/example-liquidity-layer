use anchor_lang::prelude::*;

#[error_code]
pub enum UpgradeManagerError {
    #[msg("NotUpgraded")]
    NotUpgraded = 0x10,

    #[msg("ProgramDataMismatch")]
    ProgramDataMismatch = 0x12,

    #[msg("OwnerMismatch")]
    OwnerMismatch = 0x14,
}
