use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Custodian, FastFill, ReservedFastFillSequence},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerMessage;

#[event_cpi]
#[derive(Accounts)]
pub struct ExecuteFastOrderLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    execute_order: ExecuteOrder<'info>,

    /// This account will be closed at the end of this instruction instead of using the close
    /// account directive here.
    ///
    /// NOTE: We do not need to do a VAA hash check because that was already performed when the
    /// reserved sequence was created.
    #[account(
        mut,
        seeds = [
            ReservedFastFillSequence::SEED_PREFIX,
            reserved_sequence.seeds.fast_vaa_hash.as_ref(),
        ],
        bump = reserved_sequence.seeds.bump,
    )]
    reserved_sequence: Account<'info, ReservedFastFillSequence>,

    /// When the reserved sequence account was created, the beneficiary was set to the best offer
    /// token's owner. This account will receive the lamports from the reserved sequence account.
    ///
    /// CHECK: This account's address must equal the one encoded in the reserved sequence account.
    #[account(
        mut,
        address = reserved_sequence.beneficiary,
    )]
    best_offer_participant: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = FastFill::checked_compute_size({
            let vaa = execute_order.fast_vaa.load_unchecked();

            // We can unwrap and convert to FastMarketOrder unchecked because we validate the VAA
            // hash equals the one encoded in the auction account.
            let order = LiquidityLayerMessage::try_from(vaa.payload())
                .unwrap()
                .to_fast_market_order_unchecked();

            // It is safe to convert u32 to usize here.
            order.redeemer_message_len().try_into().unwrap()
        })
        .ok_or(MatchingEngineError::FastFillTooLarge)?,
        seeds = [
            FastFill::SEED_PREFIX,
            &reserved_sequence.fast_fill_seeds.source_chain.to_be_bytes(),
            &reserved_sequence.fast_fill_seeds.order_sender,
            &reserved_sequence.fast_fill_seeds.sequence.to_be_bytes(),
        ],
        bump,
    )]
    fast_fill: Account<'info, FastFill>,

    #[account(
        mut,
        seeds = [
            crate::LOCAL_CUSTODY_TOKEN_SEED_PREFIX,
            &execute_order.fast_vaa.load_unchecked().emitter_chain().to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,

    sysvars: RequiredSysvars<'info>,
}

pub fn execute_fast_order_local(ctx: Context<ExecuteFastOrderLocal>) -> Result<()> {
    let custodian = &ctx.accounts.custodian;
    let token_program = &ctx.accounts.token_program;

    let super::PreparedOrderExecution {
        user_amount: amount,
        fill,
        beneficiary,
    } = super::prepare_order_execution(super::PrepareFastExecution {
        execute_order: &mut ctx.accounts.execute_order,
        custodian,
        token_program,
    })?;

    let fast_fill = FastFill::new(
        fill,
        ctx.accounts.reserved_sequence.fast_fill_seeds.sequence,
        ctx.bumps.fast_fill,
        ctx.accounts.payer.key(),
        amount,
    );
    emit_cpi!(crate::events::LocalFastOrderFilled {
        seeds: fast_fill.seeds,
        info: fast_fill.info,
        auction: ctx.accounts.execute_order.active_auction.key().into(),
    });
    ctx.accounts.fast_fill.set_inner(fast_fill);

    let auction_custody_token = &ctx.accounts.execute_order.active_auction.custody_token;

    // Transfer funds to the local custody account.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: auction_custody_token.to_account_info(),
                to: ctx.accounts.local_custody_token.to_account_info(),
                authority: custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        amount,
    )?;

    // Close the custody token account since it is no longer needed.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: auction_custody_token.to_account_info(),
            destination: beneficiary.unwrap_or(ctx.accounts.payer.to_account_info()),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    // Finally close the reserved sequence account and give the lamports to the best offer
    // participant.
    ctx.accounts
        .reserved_sequence
        .close(ctx.accounts.best_offer_participant.to_account_info())
}
