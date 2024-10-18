use crate::{composite::*, error::MatchingEngineError, state::AuctionConfig};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[event_cpi]
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
}

pub fn reserve_fast_fill_sequence_active_auction(
    ctx: Context<ReserveFastFillSequenceActiveAuction>,
) -> Result<()> {
    let beneficiary = ctx.accounts.reserve_sequence.payer.key();
    let fast_vaa_hash = ctx.accounts.reserve_sequence.auction.vaa_hash;

    let sequence_reserved_event = super::set_reserved_sequence_data(
        &mut ctx.accounts.reserve_sequence,
        &ctx.bumps.reserve_sequence,
        fast_vaa_hash,
        beneficiary,
    )?;

    // Emit an event indicating that the fast fill sequence has been reserved.
    emit_cpi!(sequence_reserved_event);

    Ok(())
}
