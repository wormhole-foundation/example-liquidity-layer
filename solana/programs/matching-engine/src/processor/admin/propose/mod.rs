mod auction_parameters;
pub use auction_parameters::*;

use crate::{
    composite::*,
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

    let slot_proposed_at = Clock::get().unwrap().slot;

    cfg_if::cfg_if! {
        if #[cfg(feature = "integration-test")] {
            let _ = epoch_schedule;
            // Arbitrary set for fast testing.
            let slot_enact_delay = slot_proposed_at + 8;
        } else if #[cfg(feature = "testnet")] {
            let _ = epoch_schedule;
            // Arbitrary set to roughly 10 seconds (10 seconds / 0.4 seconds per slot) for
            // faster testing.
            let slot_enact_delay = slot_proposed_at + 25;
        } else {
            let slot_enact_delay = slot_proposed_at + epoch_schedule.slots_per_epoch;
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
