use std::ops::{Deref, DerefMut};

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, Custodian, MessageProtocol, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    admin::utils::{assistant::only_authorized, ownable::only_owner},
    wormhole_cctp_solana::{
        cctp::{message_transmitter_program, token_messenger_minter_program},
        wormhole::{core_bridge_program, VaaAccount},
    },
};

#[derive(Accounts)]
pub struct CheckedCustodian<'info> {
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub inner: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

#[derive(Accounts)]
pub(crate) struct CheckedMutCustodian<'info> {
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub inner: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedMutCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<'info> DerefMut for CheckedMutCustodian<'info> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

#[derive(Accounts)]
pub(crate) struct OwnerCustodian<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(MatchingEngineError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct OwnerMutCustodian<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(MatchingEngineError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedMutCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct AdminCustodian<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(MatchingEngineError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub(crate) struct AdminMutCustodian<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(MatchingEngineError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedMutCustodian<'info>,
}

#[derive(Accounts)]
pub struct LocalTokenRouter<'info> {
    /// CHECK: Must be an executable (the Token Router program), whose ID will be used to derive the
    /// emitter (router endpoint) address.
    #[account(executable)]
    pub token_router_program: AccountInfo<'info>,

    /// CHECK: The Token Router program's emitter PDA (a.k.a. its custodian) will have account data.
    #[account(
        seeds = [b"emitter"],
        bump,
        seeds::program = token_router_program,
        owner = token_router_program.key() @ MatchingEngineError::InvalidEndpoint,
        constraint = !token_router_emitter.data_is_empty() @ MatchingEngineError::InvalidEndpoint,
    )]
    pub token_router_emitter: AccountInfo<'info>,

    #[account(
        associated_token::mint = common::constants::USDC_MINT,
        associated_token::authority = token_router_emitter,
    )]
    pub token_router_mint_recipient: Account<'info, token::TokenAccount>,
}

#[derive(Accounts)]
pub(crate) struct ExistingMutRouterEndpoint<'info> {
    #[account(
        mut,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &inner.chain.to_be_bytes()
        ],
        bump = inner.bump,
    )]
    pub inner: Account<'info, RouterEndpoint>,
}

#[derive(Accounts)]
pub struct LiveRouterEndpoint<'info> {
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &inner.chain.to_be_bytes()
        ],
        bump = inner.bump,
        constraint = {
            inner.protocol != MessageProtocol::None
        } @ MatchingEngineError::EndpointDisabled,
    )]
    pub inner: Account<'info, RouterEndpoint>,
}

impl<'info> Deref for LiveRouterEndpoint<'info> {
    type Target = Account<'info, RouterEndpoint>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

#[derive(Accounts)]
pub struct LiveRouterEndpointPair<'info> {
    pub from: LiveRouterEndpoint<'info>,

    #[account(constraint = from.chain != to.chain @ MatchingEngineError::SameEndpoint)]
    pub to: LiveRouterEndpoint<'info>,
}

#[derive(Accounts)]
pub struct ActiveAuction<'info> {
    #[account(
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            auction.vaa_hash.as_ref(),
        ],
        bump = auction.bump,
        constraint = matches!(auction.status, AuctionStatus::Active) @ MatchingEngineError::AuctionNotActive,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            auction.key().as_ref(),
        ],
        bump = auction.custody_token_bump,
    )]
    pub custody_token: Account<'info, anchor_spl::token::TokenAccount>,

    #[account(
        constraint = {
            require_eq!(
                auction.info.as_ref().unwrap().config_id,
                config.id,
                MatchingEngineError::AuctionConfigMismatch
            );
            true
        },
    )]
    pub config: Account<'info, crate::state::AuctionConfig>,

    /// CHECK: Mutable. Must have the same key in auction data.
    #[account(
        mut,
        address = auction.info.as_ref().unwrap().best_offer_token,
    )]
    pub best_offer_token: AccountInfo<'info>,
}

impl<'info> Deref for ActiveAuction<'info> {
    type Target = Account<'info, Auction>;

    fn deref(&self) -> &Self::Target {
        &self.auction
    }
}

impl<'info> DerefMut for ActiveAuction<'info> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.auction
    }
}

#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    /// CHECK: Must be owned by the Wormhole Core Bridge program.
    #[account(
        owner = core_bridge_program::id(),
        constraint = {
            VaaAccount::load(&fast_vaa)?.digest().0 == active_auction.vaa_hash
         } @ MatchingEngineError::InvalidVaa,
    )]
    pub fast_vaa: AccountInfo<'info>,

    pub active_auction: ActiveAuction<'info>,

    pub to_router_endpoint: LiveRouterEndpoint<'info>,

    /// CHECK: Must be a token account, whose mint is [common::constants::USDC_MINT].
    #[account(mut)]
    pub executor_token: AccountInfo<'info>,

    /// CHECK: Mutable. Must equal [initial_offer](Auction::initial_offer).
    #[account(
        mut,
        address = active_auction.info.as_ref().unwrap().initial_offer_token,
    )]
    pub initial_offer_token: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WormholePublishMessage<'info> {
    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    pub config: AccountInfo<'info>,

    /// CHECK: Seeds must be \["Sequence"\, custodian] (Wormhole Core Bridge program).
    #[account(mut)]
    pub emitter_sequence: AccountInfo<'info>,

    /// CHECK: Seeds must be \["fee_collector"\] (Wormhole Core Bridge program).
    #[account(mut)]
    pub fee_collector: AccountInfo<'info>,

    pub core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
}

#[derive(Accounts)]
pub struct CctpDepositForBurn<'info> {
    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(mut)]
    pub mint: AccountInfo<'info>,

    /// CHECK: Seeds must be \["sender_authority"\] (CCTP Token Messenger Minter program).
    pub token_messenger_minter_sender_authority: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    #[account(mut)]
    pub message_transmitter_config: AccountInfo<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    pub token_messenger: AccountInfo<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    pub remote_token_messenger: AccountInfo<'info>,

    /// CHECK Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    pub token_minter: AccountInfo<'info>,

    /// Local token account, which this program uses to validate the `mint` used to burn.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    pub local_token: AccountInfo<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    pub token_messenger_minter_event_authority: AccountInfo<'info>,

    pub token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    pub message_transmitter_program:
        Program<'info, message_transmitter_program::MessageTransmitter>,
}
