use std::io::Write;

use crate::{
    error::MatchingEngineError,
    state::{
        AuctionData, AuctionStatus, Custodian, PayerSequence, PreparedSlowOrder, RouterEndpoint,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{messages::raw::LiquidityLayerMessage, wormhole_io::TypePrefixedPayload};
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program::{self, VaaAccount},
};

#[derive(Accounts)]
pub struct ExecuteSlowOrderAuctionActiveCctp<'info> {
    #[account(mut)]
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
        bump = custodian.bump,
    )]
    custodian: Box<Account<'info, Custodian>>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    /// CHECK: Must be the account that created the prepared slow order.
    #[account(mut)]
    prepared_by: AccountInfo<'info>,

    #[account(
        mut,
        close = prepared_by,
        seeds = [
            PreparedSlowOrder::SEED_PREFIX,
            prepared_by.key().as_ref(),
            core_bridge_program::VaaAccount::load(&fast_vaa)?.try_digest()?.as_ref()
        ],
        bump = prepared_slow_order.bump,
    )]
    prepared_slow_order: Box<Account<'info, PreparedSlowOrder>>,

    /// There should be no account data here because an auction was never created.
    #[account(
        mut,
        seeds = [
            AuctionData::SEED_PREFIX,
            prepared_slow_order.fast_vaa_hash.as_ref(),
        ],
        bump = auction_data.bump,
        has_one = best_offer_token, // TODO: add error
        constraint = auction_data.status == AuctionStatus::Active // TODO: add error
    )]
    auction_data: Box<Account<'info, AuctionData>>,

    /// CHECK: Must equal the best offer token in the auction data account.
    #[account(mut)]
    best_offer_token: AccountInfo<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    liquidator_token: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: AccountInfo<'info>,

    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(
        mut,
        address = common::constants::usdc::id(),
    )]
    mint: AccountInfo<'info>,

    /// Seeds must be \["endpoint", chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            to_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = to_router_endpoint.bump,
    )]
    to_router_endpoint: Box<Account<'info, RouterEndpoint>>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: UncheckedAccount<'info>,

    /// Token Messenger Minter's Local Token account. This program uses the mint of this account to
    /// validate the `mint_recipient` token account's mint.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_pair", remote_domain.to_string(), remote_token_address\] (CCTP
    /// Token Messenger Minter program).
    token_pair: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    token_messenger_minter_custody_token: UncheckedAccount<'info>,

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

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

pub fn execute_slow_order_auction_active_cctp(
    ctx: Context<ExecuteSlowOrderAuctionActiveCctp>,
) -> Result<()> {
    let fast_vaa = VaaAccount::load(&ctx.accounts.fast_vaa).unwrap();
    let order = LiquidityLayerMessage::try_from(fast_vaa.try_payload().unwrap())
        .unwrap()
        .to_fast_market_order_unchecked();

    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

    // This means the slow message beat the fast message. We need to refund the bidder and
    // (potentially) take a penalty for not fulfilling their obligation. The `penalty` CAN be zero
    // in this case, since the auction grace period might not have ended yet.
    let (final_status, liquidator_amount, best_offer_amount, cctp_amount) = {
        let auction = &ctx.accounts.auction_data;
        let slots_elapsed = Clock::get().map(|clock| clock.slot - auction.start_slot)?;
        let (penalty, reward) = crate::utils::calculate_dynamic_penalty(
            &ctx.accounts.custodian.auction_config,
            auction.security_deposit,
            slots_elapsed,
        )
        .ok_or(MatchingEngineError::PenaltyCalculationFailed)?;

        let base_fee = ctx.accounts.prepared_slow_order.base_fee;
        (
            AuctionStatus::Settled {
                base_fee,
                penalty: Some(penalty),
            },
            penalty + base_fee,
            auction.amount + auction.security_deposit - penalty - reward,
            auction.amount - base_fee + reward,
        )
    };

    // Transfer to the best offer token what he deserves.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.best_offer_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[custodian_seeds],
        ),
        best_offer_amount,
    )?;

    let mut redeemer_message = Vec::with_capacity(order.redeemer_message_len().try_into().unwrap());
    redeemer_message.write_all(order.redeemer_message().into())?;

    // This returns the CCTP nonce, but we do not need it.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                src_token_owner: ctx.accounts.custodian.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                src_token: ctx.accounts.custody_token.to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            &[custodian_seeds],
        ),
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
                custodian_seeds,
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
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: ctx.accounts.to_router_endpoint.address,
            destination_cctp_domain: order.destination_cctp_domain(),
            amount: cctp_amount,
            // TODO: add mint recipient to the router endpoint account to future proof this?
            mint_recipient: ctx.accounts.to_router_endpoint.address,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::Fill {
                source_chain: ctx.accounts.prepared_slow_order.source_chain,
                order_sender: order.sender(),
                redeemer: order.redeemer(),
                redeemer_message: redeemer_message.into(),
            }
            .to_vec_payload(),
        },
    )?;

    // Everyone's whole, set the auction as completed.
    ctx.accounts.auction_data.status = final_status;

    // Transfer the penalty amount to the caller. The caller also earns the base fee for relaying
    // the slow VAA.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.liquidator_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[custodian_seeds],
        ),
        liquidator_amount,
    )
}
