use crate::admin::OwnerAssistant;
use anchor_lang::prelude::*;

pub fn only_owner_assistant<A>(
    acct: &Account<A>,
    owner_assistant: &Signer,
    custom_error: Error,
) -> Result<bool>
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    if acct.owner_assistant() == &owner_assistant.key() {
        Ok(true)
    } else {
        Err(custom_error.with_pubkeys((*acct.owner_assistant(), owner_assistant.key())))
    }
}

pub fn only_authorized<A>(
    acct: &Account<A>,
    owner_or_assistant: &Signer,
    custom_error: Error,
) -> Result<bool>
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    if acct.owner() == &owner_or_assistant.key()
        || acct.owner_assistant() == &owner_or_assistant.key()
    {
        Ok(true)
    } else {
        Err(custom_error)
    }
}

pub fn transfer_owner_assistant<A>(acct: &mut Account<A>, new_assistant: &AccountInfo)
where
    A: OwnerAssistant + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner_assistant_mut() = new_assistant.key();
}
