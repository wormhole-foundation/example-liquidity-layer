use crate::{
    error::MatchingEngineError,
    handle_fast_order_execution,
    state::{AuctionData, AuctionStatus, Custodian, PayerSequence, RouterEndpoint},
    ExecuteFastOrderAccounts,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;
use wormhole_cctp_solana::wormhole::core_bridge_program;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;

#[derive(Accounts)]
pub struct ExecuteFastOrderSolana<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority. This is also the burn-source
    /// authority for CCTP transfers.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Box<Account<'info, Custodian>>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program.
    #[account(
        owner = core_bridge_program::id(),
        constraint = VaaAccount::load(&vaa)?.try_digest()?.0 == auction_data.vaa_hash // TODO: add error
    )]
    vaa: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [
            AuctionData::SEED_PREFIX,
            auction_data.vaa_hash.as_ref()
        ],
        bump = auction_data.bump,
        has_one = best_offer_token @ MatchingEngineError::InvalidTokenAccount,
        has_one = initial_offer_token @ MatchingEngineError::InvalidTokenAccount,
        constraint = {
            auction_data.status == AuctionStatus::Active
        } @ MatchingEngineError::AuctionNotActive
    )]
    auction_data: Box<Account<'info, AuctionData>>,

    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            to_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = to_router_endpoint.bump,
        constraint = {
            to_router_endpoint.chain == core_bridge_program::SOLANA_CHAIN
        } @ MatchingEngineError::InvalidChain
    )]
    to_router_endpoint: Account<'info, RouterEndpoint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = payer
    )]
    executor_token: Account<'info, token::TokenAccount>,

    /// CHECK: Mutable. Must equal [best_offer](AuctionData::best_offer).
    #[account(mut)]
    best_offer_token: AccountInfo<'info>,

    /// CHECK: Mutable. Must equal [initial_offer](AuctionData::initial_offer).
    #[account(mut)]
    initial_offer_token: AccountInfo<'info>,

    /// Also the burn_source token account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: AccountInfo<'info>,

    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(
        mut,
        address = common::constants::usdc::id(),
    )]
    mint: AccountInfo<'info>,

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
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

pub fn execute_fast_order_solana(ctx: Context<ExecuteFastOrderSolana>) -> Result<()> {
    let wormhole_args = handle_fast_order_execution(ExecuteFastOrderAccounts {
        custodian: &ctx.accounts.custodian,
        vaa: &ctx.accounts.vaa,
        auction_data: &mut ctx.accounts.auction_data,
        custody_token: &ctx.accounts.custody_token,
        executor_token: &ctx.accounts.executor_token,
        best_offer_token: &ctx.accounts.best_offer_token,
        initial_offer_token: &ctx.accounts.initial_offer_token,
        token_program: &ctx.accounts.token_program,
    })?;

    // Publish message via Core Bridge.
    core_bridge_program::cpi::post_message(
        CpiContext::new_with_signer(
            ctx.accounts.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
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
                &[
                    Custodian::SEED_PREFIX.as_ref(),
                    &[ctx.accounts.custodian.bump],
                ],
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    ctx.accounts
                        .payer_sequence
                        .take_and_uptick()
                        .to_be_bytes()
                        .as_ref(),
                    &[ctx.bumps["core_message"]],
                ],
            ],
        ),
        core_bridge_program::cpi::PostMessageArgs {
            nonce: 0, // Always zero.
            payload: common::messages::FastFill {
                fill: wormhole_args.fill,
                amount: u128::try_from(wormhole_args.transfer_amount).unwrap(),
            }
            .to_vec_payload(),
            commitment: core_bridge_program::Commitment::Finalized,
        },
    )?;

    Ok(())
}
