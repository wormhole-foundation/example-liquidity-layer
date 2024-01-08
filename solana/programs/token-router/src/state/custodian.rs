use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,

    /// Boolean indicating whether outbound transfers are paused.
    pub paused: bool,

    /// Program's owner.
    pub owner: Pubkey,
    pub pending_owner: Option<Pubkey>,

    /// Program's assistant. Can be used to update the relayer fee and swap rate.
    pub owner_assistant: Pubkey,

    /// Indicate who last set the `paused` value. When the program is first initialized, this is set
    /// to the `owner`.
    pub paused_set_by: Pubkey,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"custodian";

    pub fn is_authorized(&self, key: &Pubkey) -> bool {
        self.owner == *key || self.owner_assistant == *key
    }
}
