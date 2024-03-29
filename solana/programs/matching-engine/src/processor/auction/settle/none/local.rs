use crate::{
    composite::*,
    state::{Auction, PayerSequence},
    utils,
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [settle_auction_none_local].
#[derive(Accounts)]
pub struct SettleAuctionNoneLocal<'info> {
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

    #[account(
        constraint = utils::require_local_endpoint(&fast_order_path.to_endpoint)?,
    )]
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
        bump,
    )]
    auction: Box<Account<'info, Auction>>,

    wormhole: WormholePublishMessage<'info>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &fast_order_path.fast_vaa.load_unchecked().emitter_chain().to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    sysvars: RequiredSysvars<'info>,
}

/// TODO: add docstring
pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
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
            dst_token: &ctx.accounts.local_custody_token,
            token_program: &ctx.accounts.token_program,
        },
        ctx.bumps.auction,
    )?;

    utils::wormhole::post_matching_engine_message(
        utils::wormhole::PostMatchingEngineMessage {
            wormhole: &ctx.accounts.wormhole,
            core_message: &ctx.accounts.core_message,
            custodian: &ctx.accounts.custodian,
            payer: &ctx.accounts.payer,
            system_program: &ctx.accounts.system_program,
            sysvars: &ctx.accounts.sysvars,
        },
        common::messages::FastFill { amount, fill },
        &sequence_seed,
        ctx.bumps.core_message,
    )
}
