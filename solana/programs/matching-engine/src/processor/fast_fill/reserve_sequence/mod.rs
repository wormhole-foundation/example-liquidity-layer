mod active_auction;
pub use active_auction::*;

mod no_auction;
pub use no_auction::*;

use crate::{
    composite::*,
    error::MatchingEngineError,
    events::FastFillSequenceReserved,
    state::{
        FastFillSeeds, FastFillSequencer, FastFillSequencerSeeds, ReservedFastFillSequence,
        ReservedFastFillSequenceSeeds,
    },
};
use anchor_lang::prelude::*;
use common::messages::raw::LiquidityLayerMessage;

fn set_reserved_sequence_data(
    reserve_sequence: &mut ReserveFastFillSequence,
    bumps: &ReserveFastFillSequenceBumps,
    fast_vaa_hash: [u8; 32],
    beneficiary: Pubkey,
) -> Result<FastFillSequenceReserved> {
    let sequencer = &mut reserve_sequence.sequencer;

    // If the fast fill sequencer was just created, we need to set it with data.
    if sequencer.seeds == Default::default() {
        msg!("Create sequencer");

        msg!(
            "account_data: {:?}",
            &reserve_sequence.fast_order_path.fast_vaa.vaa.data.borrow()[..8]
        );
        let vaa = reserve_sequence.fast_order_path.fast_vaa.load_unchecked();
        let sender = LiquidityLayerMessage::try_from(vaa.payload())
            .unwrap()
            .to_fast_market_order_unchecked()
            .sender();

        sequencer.set_inner(FastFillSequencer {
            seeds: FastFillSequencerSeeds {
                source_chain: vaa.emitter_chain(),
                sender,
                bump: bumps.sequencer,
            },
            next_sequence: 0,
        });
    }

    // Now reserve sequence.
    let reserved: &mut Box<Account<ReservedFastFillSequence>> = &mut reserve_sequence.reserved;
    let sequencer_seeds = sequencer.seeds;
    let next_sequence = &mut sequencer.next_sequence;

    let fast_fill_seeds = FastFillSeeds {
        source_chain: sequencer_seeds.source_chain,
        order_sender: sequencer_seeds.sender,
        sequence: *next_sequence,
        bump: Default::default(), // unused
    };

    // The beneficiary for the reserved fast fill sequence lamports will be the one who prepared the
    // order response. Presumably the payer will be associated with whomever prepared the order
    // response.
    reserved.set_inner(ReservedFastFillSequence {
        seeds: ReservedFastFillSequenceSeeds {
            fast_vaa_hash,
            bump: bumps.reserved,
        },
        beneficiary,
        fast_fill_seeds,
    });

    // Now uptick sequencer's value. If this errors out, we have problems.
    *next_sequence = next_sequence
        .checked_add(1)
        .ok_or_else(|| MatchingEngineError::U64Overflow)?;

    // Prepare an event to help auction participants track the fast fill sequence so they can more
    // easily execute local orders.
    Ok(FastFillSequenceReserved {
        fast_vaa_hash,
        fast_fill: fast_fill_seeds,
    })
}
