use std::io::Write;

use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{
        Auction, AuctionEntry, AuctionHistory, AuctionHistoryInternal, AuctionInfo, AuctionStatus,
    },
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::token;

#[derive(Accounts)]
pub struct AddAuctionHistoryEntry<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// CHECK: Auction history account. This account is not deserialized via Anchor account context
    /// because we will be writing to this account without using Anchor's [AccountsExit].
    #[account(
        mut,
        constraint = {
            require_keys_eq!(
                *history.owner,
                crate::id(),
                ErrorCode::ConstraintOwner,
            );

            let mut acc_data: &[_] = &history.try_borrow_data()?;
            let history = AuctionHistoryInternal::try_deserialize(&mut acc_data)?;

            require!(
                history.num_entries < AuctionHistory::MAX_ENTRIES,
                MatchingEngineError::AuctionHistoryFull,
            );

            true
        }
    )]
    history: UncheckedAccount<'info>,

    #[account(
        mut,
        close = beneficiary,
        constraint = {
            require!(
                matches!(auction.status, AuctionStatus::Settled {..}),
                MatchingEngineError::AuctionNotSettled,
            );

            let expiration =
                i64::from(auction.vaa_timestamp).saturating_add(crate::VAA_AUCTION_EXPIRATION_TIME);
            require!(
                Clock::get().unwrap().unix_timestamp >= expiration,
                MatchingEngineError::CannotCloseAuctionYet,
            );

            true
        }
    )]
    auction: Account<'info, Auction>,

    /// CHECK: This account will either be the owner of the fee recipient token account (if there
    /// was no auction) or the owner of the initial offer token account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    #[account(
        token::authority = beneficiary,
        address = {
            match &auction.info {
                Some(info) => info.initial_offer_token,
                None => custodian.fee_recipient_token,
            }
        }
    )]
    beneficiary_token: Account<'info, token::TokenAccount>,

    system_program: Program<'info, system_program::System>,
}

pub fn add_auction_history_entry(ctx: Context<AddAuctionHistoryEntry>) -> Result<()> {
    match ctx.accounts.auction.info {
        Some(info) => handle_add_auction_history_entry(ctx, info),
        None => Ok(()),
    }
}

fn handle_add_auction_history_entry(
    ctx: Context<AddAuctionHistoryEntry>,
    info: AuctionInfo,
) -> Result<()> {
    let mut history = {
        let mut acc_data: &[_] = &ctx.accounts.history.data.borrow();
        AuctionHistoryInternal::try_deserialize_unchecked(&mut acc_data).unwrap()
    };

    // This is safe because we already checked that this is less than MAX_ENTRIES.
    history.num_entries = history.num_entries.saturating_add(1);

    // Update the history account with this new entry's vaa timestamp if it is less than the min or
    // greater than the max.
    let auction = &ctx.accounts.auction;
    if auction.vaa_timestamp < history.min_timestamp.unwrap_or(u32::MAX) {
        history.min_timestamp = Some(auction.vaa_timestamp);
    }
    if auction.vaa_timestamp > history.max_timestamp.unwrap_or_default() {
        history.max_timestamp = Some(auction.vaa_timestamp);
    }

    let mut encoded_entry = Vec::with_capacity(AuctionEntry::INIT_SPACE);
    AuctionEntry {
        vaa_hash: auction.vaa_hash,
        vaa_timestamp: auction.vaa_timestamp,
        info,
    }
    .serialize(&mut encoded_entry)?;

    // Transfer lamports to history account and realloc.
    let write_index = {
        let acc_info: &UncheckedAccount = &ctx.accounts.history;

        let index = acc_info.data_len();

        // This operation should be safe because the size of an account should never be larger than
        // u64 (usize in this case).
        let new_len = index.saturating_add(encoded_entry.len());
        let lamport_diff = Rent::get()
            .unwrap()
            .minimum_balance(new_len)
            .saturating_sub(acc_info.lamports());

        // Transfer lamports
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: acc_info.to_account_info(),
                },
            ),
            lamport_diff,
        )?;

        // Realloc.
        acc_info.realloc(new_len, false)?;

        index
    };

    // Serialize the header + num entries. This is safe because the underlying data structure for
    // auction entries is a Vec, whose length is serialized as u32.
    let acc_data: &mut [_] = &mut ctx.accounts.history.try_borrow_mut_data()?;
    let mut cursor = std::io::Cursor::new(acc_data);
    history.try_serialize(&mut cursor)?;

    // This cast is safe since we know the write index is within u64.
    #[allow(clippy::as_conversions)]
    cursor.set_position(write_index as u64);

    // Serialize entry data.
    cursor.write_all(&encoded_entry).map_err(Into::into)
}
