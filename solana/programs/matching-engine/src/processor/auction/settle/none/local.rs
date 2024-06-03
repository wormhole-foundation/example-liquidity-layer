use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, Custodian, FastFill, ReservedFastFillSequence},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [settle_auction_none_local].
#[event_cpi]
#[derive(Accounts)]
pub struct SettleAuctionNoneLocal<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(
        mut,
        address = custodian.fee_recipient_token,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    #[account(
        constraint = {
            require_keys_eq!(
                prepared.by.key(),
                reserved_sequence.beneficiary,
                MatchingEngineError::PreparedByMismatch
            );

            true
        }
    )]
    prepared: ClosePreparedOrderResponse<'info>,

    /// This account will have been created using the reserve fast fill sequence (no auction)
    /// instruction. We need to make sure that this account has not been used in an auction.
    #[account(
        mut,
        seeds = [
            Auction::SEED_PREFIX,
            prepared.order_response.seeds.fast_vaa_hash.as_ref(),
        ],
        bump,
        constraint = auction.info.is_none() @ MatchingEngineError::AuctionExists,
    )]
    auction: Box<Account<'info, Auction>>,

    /// This account will be closed at the end of this instruction instead of using the close
    /// account directive here.
    ///
    /// If we could reference the beneficiary using `prepared.by`, this would be a different story.
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
        constraint = {
            require!(
                reserved_sequence.seeds.fast_vaa_hash
                    == prepared.order_response.seeds.fast_vaa_hash,
                MatchingEngineError::ReservedSequenceMismatch,
            );

            true
        }
    )]
    reserved_sequence: Account<'info, ReservedFastFillSequence>,

    #[account(
        init,
        payer = payer,
        space = FastFill::checked_compute_size(prepared.order_response.redeemer_message.len()).unwrap(),
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
            &prepared.order_response.source_chain.to_be_bytes(),
        ],
        bump,
    )]
    local_custody_token: Box<Account<'info, token::TokenAccount>>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    sysvars: RequiredSysvars<'info>,
}

pub fn settle_auction_none_local(ctx: Context<SettleAuctionNoneLocal>) -> Result<()> {
    let prepared_by = &ctx.accounts.prepared.by;
    let prepared_custody_token = &ctx.accounts.prepared.custody_token;
    let custodian = &ctx.accounts.custodian;
    let token_program = &ctx.accounts.token_program;

    let super::SettledNone {
        user_amount: amount,
        fill,
    } = super::settle_none_and_prepare_fill(
        super::SettleNoneAndPrepareFill {
            prepared_order_response: &mut ctx.accounts.prepared.order_response,
            prepared_custody_token,
            auction: &mut ctx.accounts.auction,
            fee_recipient_token: &ctx.accounts.fee_recipient_token,
            custodian,
            token_program,
        },
        ctx.bumps.auction,
    )?;

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
        auction: Default::default(),
    });
    ctx.accounts.fast_fill.set_inner(fast_fill);

    // Transfer funds to the local custody account.
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: prepared_custody_token.to_account_info(),
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
            account: prepared_custody_token.to_account_info(),
            destination: prepared_by.to_account_info(),
            authority: custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    // Finally close the reserved sequence account and give the lamports to the one who paid the
    // lamports for the prepared order response.
    ctx.accounts
        .reserved_sequence
        .close(prepared_by.to_account_info())
}
