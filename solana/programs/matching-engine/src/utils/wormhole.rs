use crate::{composite::*, state::Custodian};
use anchor_lang::prelude::*;
use common::{
    wormhole_cctp_solana::wormhole::core_bridge_program, wormhole_io::TypePrefixedPayload,
};

pub struct PostMatchingEngineMessage<'ctx, 'info> {
    pub wormhole: &'ctx WormholePublishMessage<'info>,
    pub core_message: &'ctx UncheckedAccount<'info>,
    pub custodian: &'ctx CheckedCustodian<'info>,
    pub payer: &'ctx Signer<'info>,
    pub system_program: &'ctx Program<'info, System>,
    pub sysvars: &'ctx RequiredSysvars<'info>,
}

pub fn post_matching_engine_message<M>(
    ctx: PostMatchingEngineMessage,
    message: M,
    sequence_seed: &[u8; 8],
    core_message_bump_seed: u8,
) -> Result<()>
where
    M: TypePrefixedPayload,
{
    let PostMatchingEngineMessage {
        wormhole,
        core_message,
        custodian,
        payer,
        system_program,
        sysvars,
    } = ctx;

    let WormholePublishMessage {
        core_bridge_program,
        config: core_bridge_config,
        emitter_sequence,
        fee_collector,
    } = wormhole;

    core_bridge_program::cpi::post_message(
        CpiContext::new_with_signer(
            core_bridge_program.to_account_info(),
            core_bridge_program::cpi::PostMessage {
                payer: payer.to_account_info(),
                message: core_message.to_account_info(),
                emitter: custodian.to_account_info(),
                config: core_bridge_config.to_account_info(),
                emitter_sequence: emitter_sequence.to_account_info(),
                fee_collector: fee_collector.to_account_info(),
                system_program: system_program.to_account_info(),
                clock: sysvars.clock.to_account_info(),
                rent: sysvars.rent.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    common::CORE_MESSAGE_SEED_PREFIX,
                    payer.key().as_ref(),
                    sequence_seed,
                    &[core_message_bump_seed],
                ],
            ],
        ),
        core_bridge_program::cpi::PostMessageArgs {
            nonce: common::WORMHOLE_MESSAGE_NONCE,
            payload: message.to_vec_payload(),
            commitment: core_bridge_program::Commitment::Finalized,
        },
    )
}
