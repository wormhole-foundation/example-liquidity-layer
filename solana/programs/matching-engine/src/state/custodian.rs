use anchor_lang::prelude::*;

use crate::error::MatchingEngineError;
use common::admin;

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    /// Program's owner.
    pub owner: Pubkey,
    pub pending_owner: Option<Pubkey>,

    /// Program's assistant.
    pub owner_assistant: Pubkey,

    // Recipient of `SlowOrderResponse` relay fees.
    pub fee_recipient_token: Pubkey,

    pub auction_config_id: u32,

    pub next_proposal_id: u64,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"emitter";
    pub const BUMP: u8 = crate::CUSTODIAN_BUMP;
    pub const SIGNER_SEEDS: &'static [&'static [u8]] = &[Self::SEED_PREFIX, &[Self::BUMP]];
}

impl admin::Ownable for Custodian {
    fn owner(&self) -> &Pubkey {
        &self.owner
    }

    fn owner_mut(&mut self) -> &mut Pubkey {
        &mut self.owner
    }
}

impl admin::PendingOwner for Custodian {
    fn pending_owner(&self) -> &Option<Pubkey> {
        &self.pending_owner
    }

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey> {
        &mut self.pending_owner
    }
}

impl admin::OwnerAssistant for Custodian {
    fn owner_assistant(&self) -> &Pubkey {
        &self.owner_assistant
    }

    fn owner_assistant_mut(&mut self) -> &mut Pubkey {
        &mut self.owner_assistant
    }
}

#[derive(Accounts)]
pub struct OwnerCustodian<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ MatchingEngineError::OwnerOnly)]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct OwnerMutCustodian<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ MatchingEngineError::OwnerOnly,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct AdminCustodian<'info> {
    #[account(
        constraint = {
            admin::utils::assistant::only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct AdminMutCustodian<'info> {
    #[account(
        constraint = {
            admin::utils::assistant::only_authorized(&custodian, &owner_or_assistant.key())
        } @ MatchingEngineError::OwnerOrAssistantOnly,
    )]
    pub owner_or_assistant: Signer<'info>,

    #[account(mut)]
    pub custodian: Account<'info, Custodian>,
}

#[cfg(test)]
mod test {
    use solana_program::pubkey::Pubkey;

    use super::*;

    #[test]
    fn test_bump() {
        let (custodian, bump) =
            Pubkey::find_program_address(&[Custodian::SEED_PREFIX], &crate::id());
        assert_eq!(Custodian::BUMP, bump, "bump mismatch");
        assert_eq!(
            custodian,
            Pubkey::create_program_address(Custodian::SIGNER_SEEDS, &crate::id()).unwrap(),
            "custodian mismatch",
        );
    }
}
