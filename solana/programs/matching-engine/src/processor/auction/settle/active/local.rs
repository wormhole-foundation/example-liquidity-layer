use crate::{
    error::MatchingEngineError,
    state::{
        Auction, AuctionConfig, Custodian, PayerSequence, PreparedOrderResponse, RouterEndpoint,
    },
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    wormhole_cctp_solana::wormhole::{core_bridge_program, VaaAccount, SOLANA_CHAIN},
    wormhole_io::TypePrefixedPayload,
};

/// Accounts required for [settle_auction_active_local].
#[derive(Accounts)]
pub struct SettleAuctionActiveLocal<'info> {
    #[account(
        mut,
        address = prepared_order_response.prepared_by, // TODO: add err
    )]
    payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PayerSequence::INIT_SPACE,
        seeds = [
            PayerSequence::SEED_PREFIX,
            payer.key().as_ref()
        ],
        bump,
    )]
    payer_sequence: Account<'info, PayerSequence>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: AccountInfo<'info>,

    auction_config: Box<Account<'info, AuctionConfig>>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    #[account(
        mut,
        close = payer,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            payer.key().as_ref(),
            VaaAccount::load(&fast_vaa)?.digest().as_ref()
        ],
        bump = prepared_order_response.bump,
    )]
    prepared_order_response: Box<Account<'info, PreparedOrderResponse>>,

    /// There should be no account data here because an auction was never created.
    #[account(
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref(),
        ],
        bump = auction.bump,
        constraint = utils::is_valid_active_auction(
            &auction_config,
            &auction,
            Some(best_offer_token.key()),
            None,
        )?
    )]
    auction: Box<Account<'info, Auction>>,

    /// Seeds must be \["endpoint", chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            SOLANA_CHAIN.to_be_bytes().as_ref(),
        ],
        bump = to_router_endpoint.bump,
    )]
    to_router_endpoint: Box<Account<'info, RouterEndpoint>>,

    /// CHECK: Must equal the best offer token in the auction data account.
    #[account(mut)]
    best_offer_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: Must be the same mint as the best offer token.
    #[account(mut)]
    executor_token: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ MatchingEngineError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: AccountInfo<'info>,

    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_bridge_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CORE_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    /// CHECK: Seeds must be \["Sequence"\, custodian] (Wormhole Core Bridge program).
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["fee_collector"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_fee_collector: UncheckedAccount<'info>,

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

/// TODO: add docstring
pub fn settle_auction_active_local(ctx: Context<SettleAuctionActiveLocal>) -> Result<()> {
    let super::SettledActive {
        user_amount: amount,
        fill,
        sequence_seed,
    } = super::settle_active_and_prepare_fill(super::SettleActiveAndPrepareFill {
        custodian: &ctx.accounts.custodian,
        auction_config: &ctx.accounts.auction_config,
        fast_vaa: &ctx.accounts.fast_vaa,
        auction: &mut ctx.accounts.auction,
        prepared_order_response: &ctx.accounts.prepared_order_response,
        executor_token: &ctx.accounts.executor_token,
        best_offer_token: &ctx.accounts.best_offer_token,
        cctp_mint_recipient: &ctx.accounts.cctp_mint_recipient,
        payer_sequence: &mut ctx.accounts.payer_sequence,
        token_program: &ctx.accounts.token_program,
    })?;

    // Publish message via Core Bridge.
    core_bridge_program::cpi::post_message(
        CpiContext::new_with_signer(
            ctx.accounts.core_bridge_program.to_account_info(),
            core_bridge_program::cpi::PostMessage {
                payer: ctx.accounts.payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: ctx.accounts.custodian.to_account_info(),
                config: ctx.accounts.core_bridge_config.to_account_info(),
                emitter_sequence: ctx.accounts.core_emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.core_fee_collector.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.core_message],
                ],
            ],
        ),
        core_bridge_program::cpi::PostMessageArgs {
            nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::FastFill { amount, fill }.to_vec_payload(),
            commitment: core_bridge_program::Commitment::Finalized,
        },
    )
}
