use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, AuctionStatus, MessageProtocol},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ReserveFastFillSequenceActiveAuction<'info> {
    reserve_sequence: ReserveFastFillSequence<'info>,

    /// CHECK: This auction account may not exist. If it does not exist, the prepared order response
    /// must have been created by this point. Otherwise the auction account must reflect a completed
    /// auction.
    #[account(
        seeds = [
            Auction::SEED_PREFIX,
            reserve_sequence.fast_order_path.fast_vaa.load_unchecked().digest().as_ref(),
        ],
        bump = auction.bump,
        constraint = {
            // Verify that the auction is active.
            require_eq!(
                &auction.status,
                &AuctionStatus::Active,
                MatchingEngineError::AuctionNotActive
            );

            // Out of paranoia, check that the auction is for a local fill.
            require!(
                matches!(auction.target_protocol, MessageProtocol::Local { .. }),
                MatchingEngineError::InvalidTargetRouter
            );

            true
        }
    )]
    auction: Account<'info, Auction>,

    #[account(
        constraint = {
            // We know from the auction constraint that the auction is active, so the auction info
            // is safe to unwrap.
            let info = auction.info.as_ref().unwrap();

            // Verify that the auction period has expired.
            require_eq!(
                info.config_id,
                auction_config.id,
                MatchingEngineError::AuctionConfigMismatch
            );
            require!(
                !info.within_auction_duration(&auction_config),
                MatchingEngineError::AuctionPeriodNotExpired
            );

            true

        }
    )]
    auction_config: Account<'info, AuctionConfig>,

    /// Best offer token account, whose owner will be the beneficiary of the reserved fast fill
    /// sequence account when it is closed.
    ///
    /// CHECK: This account may not exist. If it does, it should equal the best offer token pubkey
    /// in the auction account.
    #[account(
        constraint = {
            // We know from the auction constraint that the auction is active, so the auction info
            // is safe to unwrap.
            let info = auction.info.as_ref().unwrap();

            // Best offer token must equal the one in the auction account.
            //
            // NOTE: Unwrapping the auction info is safe because we know this is an active auction.
            require_keys_eq!(
                best_offer_token.key(),
                info.best_offer_token,
                MatchingEngineError::BestOfferTokenMismatch
            );

            true
        }
    )]
    best_offer_token: UncheckedAccount<'info>,

    /// CHECK: If the best offer token does not exist anymore, this executor will be the beneficiary
    /// of the reserved fast fill sequence account when it is closed. Otherwise, this account must
    /// equal the best offer token account's owner.
    executor: UncheckedAccount<'info>,
}

pub fn reserve_fast_fill_sequence_active_auction(
    ctx: Context<ReserveFastFillSequenceActiveAuction>,
) -> Result<()> {
    let best_offer_token = &ctx.accounts.best_offer_token;
    let beneficiary = ctx.accounts.executor.key();

    // If the token account does exist, we will constrain that the executor is the best offer token.
    if let Ok(token) =
        token::TokenAccount::try_deserialize(&mut &best_offer_token.data.borrow()[..])
    {
        require_keys_eq!(
            *best_offer_token.owner,
            token::ID,
            ErrorCode::ConstraintTokenTokenProgram
        );
        require_keys_eq!(token.owner, beneficiary, ErrorCode::ConstraintTokenOwner);
    }

    super::set_reserved_sequence_data(
        &mut ctx.accounts.reserve_sequence,
        &ctx.bumps.reserve_sequence,
        ctx.accounts.auction.vaa_hash,
        beneficiary,
    )
}
