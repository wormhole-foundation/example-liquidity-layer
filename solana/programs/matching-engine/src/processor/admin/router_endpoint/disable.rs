use crate::{composite::*, state::MessageProtocol};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct DisableRouterEndpoint<'info> {
    admin: OwnerOnly<'info>,

    router_endpoint: ExistingMutRouterEndpoint<'info>,
}

pub fn disable_router_endpoint(ctx: Context<DisableRouterEndpoint>) -> Result<()> {
    let endpoint = &mut ctx.accounts.router_endpoint;
    endpoint.protocol = MessageProtocol::None;
    endpoint.address = Default::default();
    endpoint.mint_recipient = Default::default();

    // Done.
    Ok(())
}
