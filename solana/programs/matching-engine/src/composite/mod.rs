use std::ops::{Deref, DerefMut};

use crate::{
    error::MatchingEngineError,
    state::{
        Auction, AuctionStatus, Custodian, MessageProtocol, PreparedOrderResponse, RouterEndpoint,
    },
    utils::{self, VaaDigest},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    admin::utils::{assistant::only_authorized, ownable::only_owner},
    messages::raw::{LiquidityLayerMessage, LiquidityLayerPayload},
    wormhole_cctp_solana::{
        cctp::{message_transmitter_program, token_messenger_minter_program},
        wormhole::{core_bridge_program, VaaAccount},
    },
};

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
        address = crate::cctp_mint_recipient::id()
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
            LiquidityLayerPayload::try_from(vaa.payload()).map_err(|_| MatchingEngineError::InvalidVaa)?;

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
            error!(MatchingEngineError::OwnerOnly)
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
            error!(MatchingEngineError::OwnerOnly)
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
            error!(MatchingEngineError::OwnerOrAssistantOnly)
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
            error!(MatchingEngineError::OwnerOrAssistantOnly)
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

#[derive(Accounts)]
pub struct LocalTokenRouter<'info> {
    /// CHECK: Must be an executable (the Token Router program), whose ID will be used to derive the
    /// emitter (router endpoint) address.
    #[account(executable)]
    pub token_router_program: UncheckedAccount<'info>,

    /// CHECK: The Token Router program's emitter PDA (a.k.a. its custodian) will have account data.
    #[account(
        seeds = [b"emitter"],
        bump,
        seeds::program = token_router_program,
        owner = token_router_program.key() @ MatchingEngineError::InvalidEndpoint,
        constraint = !token_router_emitter.data_is_empty() @ MatchingEngineError::InvalidEndpoint,
    )]
    pub token_router_emitter: UncheckedAccount<'info>,

    #[account(
        associated_token::mint = common::USDC_MINT,
        associated_token::authority = token_router_emitter,
    )]
    pub token_router_mint_recipient: Account<'info, token::TokenAccount>,
}

#[derive(Accounts)]
pub struct ExistingMutRouterEndpoint<'info> {
    #[account(
        mut,
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &endpoint.chain.to_be_bytes()
        ],
        bump = endpoint.bump,
    )]
    pub endpoint: Account<'info, RouterEndpoint>,
}

impl<'info> Deref for ExistingMutRouterEndpoint<'info> {
    type Target = Account<'info, RouterEndpoint>;

    fn deref(&self) -> &Self::Target {
        &self.endpoint
    }
}

impl<'info> DerefMut for ExistingMutRouterEndpoint<'info> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.endpoint
    }
}

#[derive(Accounts)]
pub struct LiveRouterEndpoint<'info> {
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &endpoint.chain.to_be_bytes()
        ],
        bump = endpoint.bump,
        constraint = {
            endpoint.protocol != MessageProtocol::None
        } @ MatchingEngineError::EndpointDisabled,
    )]
    pub endpoint: Box<Account<'info, RouterEndpoint>>,
}

impl<'info> Deref for LiveRouterEndpoint<'info> {
    type Target = Account<'info, RouterEndpoint>;

    fn deref(&self) -> &Self::Target {
        &self.endpoint
    }
}

#[derive(Accounts)]
pub struct LiveRouterPath<'info> {
    pub from_endpoint: LiveRouterEndpoint<'info>,

    #[account(
        constraint = from_endpoint.chain != to_endpoint.chain @ MatchingEngineError::SameEndpoint
    )]
    pub to_endpoint: LiveRouterEndpoint<'info>,
}

#[derive(Accounts)]
pub struct FastOrderPath<'info> {
    #[account(
        constraint = {
            let vaa = fast_vaa.load_unchecked();
            require_eq!(
                path.from_endpoint.chain,
                vaa.emitter_chain(),
                MatchingEngineError::InvalidSourceRouter
            );
            require!(
                path.from_endpoint.address == vaa.emitter_address(),
                MatchingEngineError::InvalidSourceRouter
            );

            let message = LiquidityLayerMessage::try_from(vaa.payload()).unwrap();
            let order = message
                .fast_market_order()
                .ok_or(MatchingEngineError::NotFastMarketOrder)?;
            require_eq!(
                path.to_endpoint.chain,
                order.target_chain(),
                MatchingEngineError::InvalidTargetRouter
            );

            true
        }
    )]
    pub fast_vaa: LiquidityLayerVaa<'info>,

    pub path: LiveRouterPath<'info>,
}

impl<'info> Deref for FastOrderPath<'info> {
    type Target = LiveRouterPath<'info>;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
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
    pub auction: Box<Account<'info, Auction>>,

    #[account(
        mut,
        seeds = [
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            auction.key().as_ref(),
        ],
        bump = auction.info.as_ref().unwrap().custody_token_bump,
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
    pub best_offer_token: UncheckedAccount<'info>,
}

impl<'info> VaaDigest for ActiveAuction<'info> {
    fn digest(&self) -> [u8; 32] {
        self.auction.vaa_hash
    }
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
        constraint = utils::require_vaa_hash_equals(&active_auction, &fast_vaa.load_unchecked())?
    )]
    pub fast_vaa: LiquidityLayerVaa<'info>,

    pub active_auction: ActiveAuction<'info>,

    /// CHECK: Must be a token account, whose mint is [common::USDC_MINT].
    #[account(mut)]
    pub executor_token: UncheckedAccount<'info>,

    /// CHECK: Mutable. Must equal [initial_offer](Auction::initial_offer).
    #[account(
        mut,
        address = active_auction.info.as_ref().unwrap().initial_offer_token,
    )]
    pub initial_offer_token: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WormholePublishMessage<'info> {
    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    pub config: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["Sequence"\, custodian] (Wormhole Core Bridge program).
    #[account(mut)]
    pub emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["fee_collector"\] (Wormhole Core Bridge program).
    #[account(mut)]
    pub fee_collector: UncheckedAccount<'info>,

    pub core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
}

#[derive(Accounts)]
pub struct CctpDepositForBurn<'info> {
    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["sender_authority"\] (CCTP Token Messenger Minter program).
    pub token_messenger_minter_sender_authority: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    #[account(mut)]
    pub message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    pub token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    pub remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    pub token_minter: UncheckedAccount<'info>,

    /// Local token account, which this program uses to validate the `mint` used to burn.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    pub local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    pub token_messenger_minter_event_authority: UncheckedAccount<'info>,

    pub token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    pub message_transmitter_program:
        Program<'info, message_transmitter_program::MessageTransmitter>,
}

#[derive(Accounts)]
pub struct CctpReceiveMessage<'info> {
    pub mint_recipient: CctpMintRecipientMut<'info>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    pub message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    pub message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    pub used_nonces: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Message Transmitter program)).
    pub message_transmitter_event_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    pub token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    pub remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    pub token_minter: UncheckedAccount<'info>,

    /// Token Messenger Minter's Local Token account. This program uses the mint of this account to
    /// validate the `mint_recipient` token account's mint.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    pub local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_pair", remote_domain.to_string(), remote_token_address\] (CCTP
    /// Token Messenger Minter program).
    pub token_pair: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    pub token_messenger_minter_custody_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (CCTP Token Messenger Minter program).
    pub token_messenger_minter_event_authority: UncheckedAccount<'info>,

    pub token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    pub message_transmitter_program:
        Program<'info, message_transmitter_program::MessageTransmitter>,
}

#[derive(Accounts)]
pub struct ClosePreparedOrderResponse<'info> {
    /// CHECK: Must equal the prepared_by field in the prepared order response.
    #[account(
        mut,
        address = order_response.prepared_by,
    )]
    pub by: UncheckedAccount<'info>,

    #[account(
        mut,
        close = by,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            order_response.fast_vaa_hash.as_ref()
        ],
        bump = order_response.bump,
    )]
    pub order_response: Box<Account<'info, PreparedOrderResponse>>,

    /// CHECK: Seeds must be \["prepared-custody"\, prepared_order_response.key()].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            order_response.key().as_ref(),
        ],
        bump,
    )]
    pub custody_token: UncheckedAccount<'info>,
}

impl<'info> VaaDigest for ClosePreparedOrderResponse<'info> {
    fn digest(&self) -> [u8; 32] {
        self.order_response.fast_vaa_hash
    }
}

/// NOTE: Keep this at the end in case Wormhole removes the need for these accounts.
#[derive(Accounts)]
pub struct RequiredSysvars<'info> {
    /// Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    ///
    /// CHECK: Must equal clock ID.
    #[account(address = solana_program::sysvar::clock::id())]
    pub clock: UncheckedAccount<'info>,

    /// Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    ///
    /// CHECK: Must equal rent ID.
    #[account(address = solana_program::sysvar::rent::id())]
    pub rent: UncheckedAccount<'info>,
}
