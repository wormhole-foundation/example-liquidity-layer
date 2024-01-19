use crate::state::{AuctionData, AuctionStatus, Custodian, PreparedSlowOrder};
use anchor_lang::prelude::*;
use anchor_spl::token;
use wormhole_cctp_solana::wormhole::core_bridge_program;

#[derive(Accounts)]
pub struct ExecuteSlowOrderAuctionComplete<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    #[account(
        mut,
        close = payer,
        seeds = [
            PreparedSlowOrder::SEED_PREFIX,
            payer.key().as_ref(),
            core_bridge_program::VaaAccount::load(&fast_vaa)?.try_digest()?.as_ref()
        ],
        bump = prepared_slow_order.bump,
    )]
    prepared_slow_order: Account<'info, PreparedSlowOrder>,

    #[account(
        seeds = [
            AuctionData::SEED_PREFIX,
            prepared_slow_order.fast_vaa_hash.as_ref(),
        ],
        bump = auction_data.bump,
        has_one = best_offer_token, // TODO: add error
        constraint = auction_data.status == AuctionStatus::Completed // TODO: add error
    )]
    auction_data: Account<'info, AuctionData>,

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
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn execute_slow_order_auction_complete(
    ctx: Context<ExecuteSlowOrderAuctionComplete>,
) -> Result<()> {
    ctx.accounts.auction_data.status = AuctionStatus::Settled {
        base_fee: ctx.accounts.prepared_slow_order.base_fee,
        penalty: None,
    };

    // Finally transfer the funds back to the highest bidder.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.best_offer_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[&[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]]],
        ),
        ctx.accounts.auction_data.amount,
    )
}
