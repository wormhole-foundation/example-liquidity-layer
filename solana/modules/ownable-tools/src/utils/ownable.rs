use crate::Ownable;
use anchor_lang::prelude::*;

pub fn only_owner<A>(acct: &Account<A>, owner: &Pubkey) -> bool
where
    A: Ownable + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner() == *owner
}

pub fn transfer_ownership<A>(acct: &mut Account<A>, new_owner: &Pubkey)
where
    A: Ownable + Clone + AccountSerialize + AccountDeserialize,
{
    *acct.owner_mut() = *new_owner;
}
