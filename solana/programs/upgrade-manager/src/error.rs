#[anchor_lang::error_code]
pub enum UpgradeManagerError {
    NotUpgraded = 0x10,
    ProgramDataMismatch = 0x12,
    OwnerMismatch = 0x14,
}
