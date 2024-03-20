use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionStatus, Custodian, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct SettleAuctionComplete<'info> {
    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be the account that created the prepared slow order.
    #[account(mut)]
    prepared_by: AccountInfo<'info>,

    #[account(
        mut,
        close = prepared_by,
        seeds = [
            PreparedOrderResponse::SEED_PREFIX,
            prepared_by.key().as_ref(),
            prepared_order_response.fast_vaa_hash.as_ref()
        ],
        bump = prepared_order_response.bump,
    )]
    prepared_order_response: Account<'info, PreparedOrderResponse>,

    #[account(
        seeds = [
            Auction::SEED_PREFIX,
            prepared_order_response.fast_vaa_hash.as_ref(),
        ],
        bump = auction.bump,
        constraint = {
            require!(
                matches!(auction.status, AuctionStatus::Completed { .. }),
                MatchingEngineError::AuctionNotCompleted,
            );

            require_keys_eq!(
                best_offer_token.key(),
                auction.info.as_ref().unwrap().best_offer_token,
                MatchingEngineError::BestOfferTokenMismatch,
            );
            true
        }
    )]
    auction: Account<'info, Auction>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    best_offer_token: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id(),
    )]
    cctp_mint_recipient: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn settle_auction_complete(ctx: Context<SettleAuctionComplete>) -> Result<()> {
    ctx.accounts.auction.status = AuctionStatus::Settled {
        base_fee: ctx.accounts.prepared_order_response.base_fee,
        penalty: None,
    };

    // Finally transfer the funds back to the highest bidder.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.cctp_mint_recipient.to_account_info(),
                to: ctx.accounts.best_offer_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        ctx.accounts.auction.info.as_ref().unwrap().amount_in,
    )
}
