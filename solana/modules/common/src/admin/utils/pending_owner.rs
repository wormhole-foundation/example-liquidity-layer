use crate::admin::PendingOwner;
use anchor_lang::prelude::*;

pub fn only_pending_owner_unchecked<A>(acct: &Account<A>, pending_owner: &Pubkey) -> bool
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    acct.pending_owner().unwrap() == *pending_owner
}

pub fn only_pending_owner<A>(acct: &Account<A>, pending_owner: &Pubkey) -> bool
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    let pending = acct.pending_owner();
    pending.is_some() && only_pending_owner_unchecked(acct, pending_owner)
}

pub fn transfer_ownership<A>(acct: &mut Account<A>, new_owner: &Pubkey)
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    acct.pending_owner_mut().replace(*new_owner);
}

pub fn accept_ownership_unchecked<A>(acct: &mut Account<A>)
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner_mut() = *acct.pending_owner().as_ref().unwrap();
    *acct.pending_owner_mut() = None;
}

pub fn accept_ownership<A>(acct: &mut Account<A>) -> bool
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    if acct.pending_owner().is_some() {
        accept_ownership_unchecked(acct);
        true
    } else {
        false
    }
}

pub fn cancel_transfer_ownership<A>(acct: &mut Account<A>)
where
    A: PendingOwner + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.pending_owner_mut() = None;
}
