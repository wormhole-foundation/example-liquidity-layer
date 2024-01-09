use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,

    /// Boolean indicating whether outbound transfers are paused.
    pub paused: bool,

    /// Indicate who last set the `paused` value. When the program is first initialized, this is set
    /// to the `owner`.
    pub paused_set_by: Pubkey,

    pub owner: Pubkey,

    pub pending_owner: Option<Pubkey>,

    pub owner_assistant: Pubkey,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"custodian";

    // pub fn is_authorized(&self, owner_or_assistant: &Pubkey) -> bool {
    //     self.owner_config.is_admin(owner_or_assistant)
    // }
}

impl ownable_tools::Ownable for Custodian {
    fn owner(&self) -> &Pubkey {
        &self.owner
    }

    fn owner_mut(&mut self) -> &mut Pubkey {
        &mut self.owner
    }
}

impl ownable_tools::PendingOwner for Custodian {
    fn pending_owner(&self) -> &Option<Pubkey> {
        &self.pending_owner
    }

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey> {
        &mut self.pending_owner
    }
}

impl ownable_tools::OwnerAssistant for Custodian {
    fn owner_assistant(&self) -> &Pubkey {
        &self.owner_assistant
    }

    fn owner_assistant_mut(&mut self) -> &mut Pubkey {
        &mut self.owner_assistant
    }
}
