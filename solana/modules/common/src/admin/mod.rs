pub mod cpi;

pub mod utils;

use anchor_lang::prelude::Pubkey;

pub trait Ownable {
    fn owner(&self) -> &Pubkey;

    fn owner_mut(&mut self) -> &mut Pubkey;
}

pub trait PendingOwner: Ownable {
    fn pending_owner(&self) -> &Option<Pubkey>;

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey>;
}

pub trait OwnerAssistant: Ownable {
    fn owner_assistant(&self) -> &Pubkey;

    fn owner_assistant_mut(&mut self) -> &mut Pubkey;
}

#[cfg(test)]
mod tests {
    //    use super::*;
    // TODO
}
