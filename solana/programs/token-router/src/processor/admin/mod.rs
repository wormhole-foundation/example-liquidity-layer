mod add_router_endpoint;
pub use add_router_endpoint::*;

mod initialize;
pub use initialize::*;

mod ownership_transfer_request;
pub use ownership_transfer_request::*;

mod set_pause;
pub use set_pause::*;

mod update;
pub use update::*;

use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;

pub(self) fn require_owner_or_assistant(
    custodian: &Custodian,
    caller: &AccountInfo,
) -> Result<bool> {
    require!(
        *caller.key == custodian.owner || *caller.key == custodian.owner_assistant,
        TokenRouterError::OwnerOrAssistantOnly
    );

    Ok(true)
}
