use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    pub bump: u8,
    pub custody_token_bump: u8,

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
}

impl common::admin::Ownable for Custodian {
    fn owner(&self) -> &Pubkey {
        &self.owner
    }

    fn owner_mut(&mut self) -> &mut Pubkey {
        &mut self.owner
    }
}

impl common::admin::PendingOwner for Custodian {
    fn pending_owner(&self) -> &Option<Pubkey> {
        &self.pending_owner
    }

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey> {
        &mut self.pending_owner
    }
}

impl common::admin::OwnerAssistant for Custodian {
    fn owner_assistant(&self) -> &Pubkey {
        &self.owner_assistant
    }

    fn owner_assistant_mut(&mut self) -> &mut Pubkey {
        &mut self.owner_assistant
    }
}
