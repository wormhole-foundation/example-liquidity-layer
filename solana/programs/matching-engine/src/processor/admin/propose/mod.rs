mod auction_parameters;
pub use auction_parameters::*;

use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Proposal, ProposalAction},
};
use anchor_lang::prelude::*;

struct Propose<'ctx, 'info> {
    custodian: &'ctx CheckedCustodian<'info>,
    proposal: &'ctx mut Account<'info, Proposal>,
    by: &'ctx Signer<'info>,
    epoch_schedule: &'ctx Sysvar<'info, EpochSchedule>,
}

fn propose(accounts: Propose, action: ProposalAction, proposal_bump_seed: u8) -> Result<()> {
    let Propose {
        custodian,
        proposal,
        by,
        epoch_schedule,
    } = accounts;

    // Even though we will all be dead by the time this triggers, we will check if the next proposal
    // ID will not overflow.
    custodian
        .next_proposal_id
        .checked_add(1)
        .ok_or_else(|| MatchingEngineError::U64Overflow)?;

    let slot_proposed_at = Clock::get().unwrap().slot;

    cfg_if::cfg_if! {
        if #[cfg(feature = "integration-test")] {
            let _ = epoch_schedule;
            // Arbitrary set for fast testing.
            let slot_enact_delay = slot_proposed_at
                .checked_add(8)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
        } else if #[cfg(feature = "testnet")] {
            let _ = epoch_schedule;
            // Arbitrary set to roughly 10 seconds (10 seconds / 0.4 seconds per slot) for
            // faster testing.
            let slot_enact_delay = slot_proposed_at
                .checked_add(25)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
        } else {
            let slot_enact_delay = slot_proposed_at
                .checked_add(epoch_schedule.slots_per_epoch)
                .ok_or_else(|| MatchingEngineError::U64Overflow)?;
        }
    }

    // Create the proposal.
    proposal.set_inner(Proposal {
        id: custodian.next_proposal_id,
        bump: proposal_bump_seed,
        action,
        by: by.key(),
        owner: custodian.owner.key(),
        slot_proposed_at,
        slot_enact_delay,
        slot_enacted_at: None,
    });

    // Done.
    Ok(())
}
