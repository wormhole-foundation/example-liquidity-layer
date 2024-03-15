use crate::admin::Ownable;
use anchor_lang::prelude::*;

pub fn only_owner<A>(acct: &Account<A>, owner: &Signer, custom_error: Error) -> Result<bool>
where
    A: Ownable + Clone + AccountSerialize + AccountDeserialize,
{
    if acct.owner() == &owner.key() {
        Ok(true)
    } else {
        Err(custom_error.with_pubkeys((*acct.owner(), owner.key())))
    }
}

pub fn transfer_ownership<A>(acct: &mut Account<A>, new_owner: &AccountInfo)
where
    A: Ownable + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner_mut() = new_owner.key();
}
