use crate::{
    error::MatchingEngineError,
    state::{AuctionData, AuctionStatus, Custodian, PayerSequence, RouterEndpoint},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerPayload;
use wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program,
};

#[derive(Accounts)]
pub struct ExecuteFastOrder<'info> {
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
    )]
    to_router_endpoint: Account<'info, RouterEndpoint>,

    #[account(
        mut,
        associated_token::mint = custody_token.mint,
        associated_token::authority = payer
    )]
    executor_token: Account<'info, token::TokenAccount>,

    /// CHECK: Mutable. Must equal [best_offer](AuctionData::best_offer).
    #[account(
        mut,
        constraint = {
            best_offer_token.key() == auction_data.best_offer.key()
        } @ MatchingEngineError::InvalidTokenAccount,
    )]
    best_offer_token: AccountInfo<'info>,

    /// CHECK: Mutable. Must equal [initial_offer](AuctionData::initial_offer).
    #[account(
        mut,
        constraint = {
            initial_offer_token.key() == auction_data.initial_offer.key()
        } @ MatchingEngineError::InvalidTokenAccount,
    )]
    initial_offer_token: AccountInfo<'info>,

    /// Also the burn_source token account.
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Box<Account<'info, token::TokenAccount>>,

    /// Circle-supported mint.
    ///
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

    /// CHECK: Seeds must be \["sender_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_sender_authority: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    #[account(mut)]
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: UncheckedAccount<'info>,

    /// Local token account, which this program uses to validate the `mint` used to burn.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: UncheckedAccount<'info>,

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

pub fn execute_fast_order(ctx: Context<ExecuteFastOrder>) -> Result<()> {
    let slots_elapsed = Clock::get()?
        .slot
        .checked_sub(ctx.accounts.auction_data.start_slot)
        .unwrap();
    let auction_config = &ctx.accounts.custodian.auction_config;
    require!(
        slots_elapsed > u64::try_from(auction_config.auction_duration).unwrap(),
        MatchingEngineError::AuctionPeriodNotExpired
    );

    // Create zero copy reference to `FastMarketOrder` payload.
    let vaa = VaaAccount::load(&ctx.accounts.vaa)?;
    let msg = LiquidityLayerPayload::try_from(vaa.try_payload()?)
        .map_err(|_| MatchingEngineError::InvalidVaa)?
        .message();
    let fast_order = msg
        .fast_market_order()
        .ok_or(MatchingEngineError::NotFastMarketOrder)?;
    let auction_data = &mut ctx.accounts.auction_data;

    // Save the custodian seeds to sign transfers with.
    let custodian_seeds = &[
        Custodian::SEED_PREFIX.as_ref(),
        &[ctx.accounts.custodian.bump],
    ];

    if slots_elapsed > u64::try_from(auction_config.auction_grace_period).unwrap() {
        let (penalty, reward) = ctx
            .accounts
            .custodian
            .calculate_dynamic_penalty(auction_data.security_deposit, slots_elapsed)
            .ok_or(MatchingEngineError::PenaltyCalculationFailed)?;

        // If caller passes in the same token account, only perform one transfer.
        if ctx.accounts.best_offer_token.key() == ctx.accounts.executor_token.key() {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.custody_token.to_account_info(),
                        to: ctx.accounts.best_offer_token.to_account_info(),
                        authority: ctx.accounts.custodian.to_account_info(),
                    },
                    &[&custodian_seeds[..]],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap(),
            )?;
        } else {
            // Pay the liquidator the penalty.
            if penalty > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: ctx.accounts.custody_token.to_account_info(),
                            to: ctx.accounts.executor_token.to_account_info(),
                            authority: ctx.accounts.custodian.to_account_info(),
                        },
                        &[&custodian_seeds[..]],
                    ),
                    penalty,
                )?;
            }

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: ctx.accounts.custody_token.to_account_info(),
                        to: ctx.accounts.best_offer_token.to_account_info(),
                        authority: ctx.accounts.custodian.to_account_info(),
                    },
                    &[&custodian_seeds[..]],
                ),
                auction_data
                    .offer_price
                    .checked_add(auction_data.security_deposit)
                    .unwrap()
                    .checked_sub(reward)
                    .unwrap()
                    .checked_sub(penalty)
                    .unwrap(),
            )?;
        }

        // TODO: Do the CCTP transfer or create a fast fill here.
    } else {
        // Return the security deposit and the fee to the highest bidder.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.custody_token.to_account_info(),
                    to: ctx.accounts.best_offer_token.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[&custodian_seeds[..]],
            ),
            auction_data
                .offer_price
                .checked_add(auction_data.security_deposit)
                .unwrap(),
        )?;
    }

    // Pay the auction initiator their fee.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.initial_offer_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[&custodian_seeds[..]],
        ),
        u64::try_from(fast_order.init_auction_fee()).unwrap(),
    )?;

    // Set the auction status to completed.
    auction_data.status = AuctionStatus::Completed;

    Ok(())
}

// TODO: need to validate that the caller passed in the correct token accounts
// and not just their own to steal funds. Look at ALL instructions.
