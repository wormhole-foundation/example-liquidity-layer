use std::ops::Deref;

use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    admin::utils::{assistant::only_authorized, ownable::only_owner},
    messages::raw::LiquidityLayerMessage,
    wormhole_cctp_solana::wormhole::VaaAccount,
};
use matching_engine::state::RouterEndpoint;

#[derive(Accounts)]
pub struct Usdc<'info> {
    /// CHECK: This address must equal [USDC_MINT](common::USDC_MINT).
    #[account(address = common::USDC_MINT)]
    pub mint: UncheckedAccount<'info>,
}

impl<'info> Deref for Usdc<'info> {
    type Target = UncheckedAccount<'info>;

    fn deref(&self) -> &Self::Target {
        &self.mint
    }
}

/// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
/// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
/// from its custody account to this account.
///
/// CHECK: Mutable. Seeds must be \["custody"\].
///
/// NOTE: This account must be encoded as the mint recipient in the CCTP message.
#[derive(Accounts)]
pub struct CctpMintRecipientMut<'info> {
    #[account(
        mut,
        address = crate::CCTP_MINT_RECIPIENT
    )]
    pub mint_recipient: Box<Account<'info, token::TokenAccount>>,
}

impl<'info> Deref for CctpMintRecipientMut<'info> {
    type Target = Account<'info, token::TokenAccount>;

    fn deref(&self) -> &Self::Target {
        &self.mint_recipient
    }
}

#[derive(Accounts)]
pub struct LiquidityLayerVaa<'info> {
    /// CHECK: This VAA account must be a posted VAA from the Wormhole Core Bridge program.
    #[account(
        constraint = {
            // NOTE: This load performs an owner check.
            let vaa = VaaAccount::load(&vaa)?;

            // Is it a legitimate LL message?
            LiquidityLayerMessage::try_from(vaa.payload()).map_err(|_| TokenRouterError::InvalidVaa)?;

            // Done.
            true
        }
    )]
    pub vaa: UncheckedAccount<'info>,
}

impl<'info> LiquidityLayerVaa<'info> {
    pub fn load_unchecked(&self) -> VaaAccount<'_> {
        VaaAccount::load_unchecked(self)
    }
}

impl<'info> Deref for LiquidityLayerVaa<'info> {
    type Target = UncheckedAccount<'info>;

    fn deref(&self) -> &Self::Target {
        &self.vaa
    }
}

#[derive(Accounts)]
pub struct CheckedCustodian<'info> {
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.custodian
    }
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(TokenRouterError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnlyMut<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(TokenRouterError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(TokenRouterError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct AdminMut<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(TokenRouterError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

/// Registered router endpoint representing a foreign Token Router. This account may have a CCTP
/// domain encoded if this route is CCTP-enabled. For this instruction, it is required that
/// [RouterEndpoint::cctp_domain] is `Some(value)`.
///
/// Seeds must be \["registered_emitter", chain.to_be_bytes()\].
#[derive(Accounts)]
pub struct RegisteredEndpoint<'info> {
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = endpoint.bump,
        seeds::program = matching_engine::id(),
        constraint = {
            require!(
                endpoint.protocol != matching_engine::state::MessageProtocol::None,
                TokenRouterError::EndpointDisabled
            );

            true
        }
    )]
    endpoint: Box<Account<'info, RouterEndpoint>>,
}

impl<'info> Deref for RegisteredEndpoint<'info> {
    type Target = Account<'info, RouterEndpoint>;

    fn deref(&self) -> &Self::Target {
        &self.endpoint
    }
}
