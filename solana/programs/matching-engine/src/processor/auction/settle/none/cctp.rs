use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, Custodian, MessageProtocol, PayerSequence, RouterEndpoint},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{wormhole_cctp_solana, wormhole_io::TypePrefixedPayload};

/// Accounts required for [settle_auction_none_cctp].
#[derive(Accounts)]
pub struct SettleAuctionNoneCctp<'info> {
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
    payer_sequence: Box<Account<'info, PayerSequence>>,

    /// CHECK: Mutable. Seeds must be \["core-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CORE_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            &payer_sequence.value.to_be_bytes(),
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["cctp-msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CCTP_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            &payer_sequence.value.to_be_bytes(),
        ],
        bump,
    )]
    cctp_message: AccountInfo<'info>,

    custodian: CheckedCustodian<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(
        mut,
        address = custodian.fee_recipient_token,
    )]
    fee_recipient_token: AccountInfo<'info>,

    #[account(
        constraint = utils::require_vaa_hash_equals(
            &prepared,
            &fast_order_path.fast_vaa.load_unchecked()
        )?,
    )]
    prepared: ClosePreparedOrderResponse<'info>,

    fast_order_path: FastOrderPath<'info>,

    /// There should be no account data here because an auction was never created.
    #[account(
        init,
        payer = payer,
        space = 8 + Auction::INIT_SPACE_NO_AUCTION,
        seeds = [
            Auction::SEED_PREFIX,
            prepared.order_response.fast_vaa_hash.as_ref(),
        ],
        bump
    )]
    auction: Box<Account<'info, Auction>>,

    wormhole: WormholePublishMessage<'info>,

    cctp: CctpDepositForBurn<'info>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    sysvars: RequiredSysvars<'info>,
}

/// TODO: add docstring
pub fn settle_auction_none_cctp(ctx: Context<SettleAuctionNoneCctp>) -> Result<()> {
    match ctx.accounts.fast_order_path.to_endpoint.protocol {
        MessageProtocol::Cctp { domain } => handle_settle_auction_none_cctp(ctx, domain),
        _ => err!(MatchingEngineError::InvalidCctpEndpoint),
    }
}

/// TODO: add docstring
fn handle_settle_auction_none_cctp(
    ctx: Context<SettleAuctionNoneCctp>,
    destination_cctp_domain: u32,
) -> Result<()> {
    let super::SettledNone {
        user_amount: amount,
        fill,
        sequence_seed,
    } = super::settle_none_and_prepare_fill(
        super::SettleNoneAndPrepareFill {
            payer_sequence: &mut ctx.accounts.payer_sequence,
            fast_vaa: &ctx.accounts.fast_order_path.fast_vaa,
            prepared_order_response: &ctx.accounts.prepared.order_response,
            prepared_custody_token: &ctx.accounts.prepared.custody_token,
            auction: &mut ctx.accounts.auction,
            fee_recipient_token: &ctx.accounts.fee_recipient_token,
            dst_token: &ctx.accounts.cctp.burn_source,
            token_program: &ctx.accounts.token_program,
        },
        ctx.bumps.auction,
    )?;

    let RouterEndpoint {
        bump: _,
        chain: _,
        address: destination_caller,
        mint_recipient,
        protocol: _,
    } = ctx.accounts.fast_order_path.to_endpoint.as_ref();

    // This returns the CCTP nonce, but we do not need it.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .cctp
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                burn_token_owner: ctx.accounts.custodian.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                burn_token: ctx.accounts.cctp.burn_source.to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .cctp
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.cctp.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.cctp.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.cctp.token_minter.to_account_info(),
                local_token: ctx.accounts.cctp.local_token.to_account_info(),
                mint: ctx.accounts.cctp.mint.to_account_info(),
                cctp_message: ctx.accounts.cctp_message.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .cctp
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                event_authority: ctx
                    .accounts
                    .cctp
                    .token_messenger_minter_event_authority
                    .to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::constants::CCTP_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    sequence_seed.as_ref(),
                    &[ctx.bumps.cctp_message],
                ],
            ],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.wormhole.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: ctx.accounts.payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: ctx.accounts.custodian.to_account_info(),
                config: ctx.accounts.wormhole.config.to_account_info(),
                emitter_sequence: ctx.accounts.wormhole.emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.wormhole.fee_collector.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.sysvars.clock.to_account_info(),
                rent: ctx.accounts.sysvars.rent.to_account_info(),
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
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: None,
            destination_caller: *destination_caller,
            destination_cctp_domain,
            amount,
            mint_recipient: *mint_recipient,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: fill.to_vec_payload(),
        },
    )?;

    // Done.
    Ok(())
}
