use crate::{composite::*, error::MatchingEngineError, state::AuctionConfig};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct ReserveFastFillSequenceActiveAuction<'info> {
    reserve_sequence: ReserveFastFillSequence<'info>,

    #[account(
        constraint = match &reserve_sequence.auction.info {
            Some(info) => {
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

            },
            _ => return err!(MatchingEngineError::NoAuction),
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
            let info = reserve_sequence.auction.info.as_ref().unwrap();

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

    let fast_vaa_hash = ctx.accounts.reserve_sequence.auction.vaa_hash;

    super::set_reserved_sequence_data(
        &mut ctx.accounts.reserve_sequence,
        &ctx.bumps.reserve_sequence,
        fast_vaa_hash,
        beneficiary,
    )
}
