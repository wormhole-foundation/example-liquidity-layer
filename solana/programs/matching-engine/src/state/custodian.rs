use std::ops::{Deref, DerefMut};

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
pub struct CheckedCustodian<'info> {
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub inner: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

#[derive(Accounts)]
pub(crate) struct CheckedMutCustodian<'info> {
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub inner: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedMutCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<'info> DerefMut for CheckedMutCustodian<'info> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

#[derive(Accounts)]
pub(crate) struct OwnerCustodian<'info> {
    #[account(
        constraint = admin::utils::ownable::only_owner(
            &custodian,
            &owner,
            error!(MatchingEngineError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct OwnerMutCustodian<'info> {
    #[account(
        constraint = admin::utils::ownable::only_owner(
            &custodian,
            &owner,
            error!(MatchingEngineError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedMutCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct AdminCustodian<'info> {
    #[account(
        constraint = admin::utils::assistant::only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(MatchingEngineError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct AdminMutCustodian<'info> {
    #[account(
        constraint = admin::utils::assistant::only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(MatchingEngineError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedMutCustodian<'info>,
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
