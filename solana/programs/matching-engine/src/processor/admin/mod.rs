mod add_router_endpoint;
pub use add_router_endpoint::*;

mod initialize;
pub use initialize::*;

use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::prelude::*;

pub(self) fn require_owner_or_assistant(
    custodian: &Custodian,
    caller: &AccountInfo,
) -> Result<bool> {
    require!(
        *caller.key == custodian.owner || *caller.key == custodian.owner_assistant,
        MatchingEngineError::OwnerOrAssistantOnly
    );

    Ok(true)
}
