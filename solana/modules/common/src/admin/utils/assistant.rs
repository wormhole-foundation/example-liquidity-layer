use crate::admin::OwnerAssistant;
use anchor_lang::prelude::*;

pub fn only_owner_assistant<A>(acct: &Account<A>, owner_assistant: &Pubkey) -> bool
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    acct.owner_assistant() == owner_assistant
}

pub fn only_authorized<A>(acct: &Account<A>, owner_or_assistant: &Pubkey) -> bool
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    acct.owner() == owner_or_assistant || acct.owner_assistant() == owner_or_assistant
}

pub fn transfer_owner_assistant<A>(acct: &mut Account<A>, new_assistant: &Pubkey)
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner_assistant_mut() = *new_assistant;
}
