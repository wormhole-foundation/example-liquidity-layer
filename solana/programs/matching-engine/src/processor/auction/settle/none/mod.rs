mod cctp;
pub use cctp::*;

mod local;
pub use local::*;

use crate::{
    events::AuctionSettled,
    state::{Auction, AuctionStatus, PreparedOrderResponse},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{spl_token, TokenAccount};
use common::messages::Fill;
use solana_program::program::invoke_signed_unchecked;

pub struct SettleNoneAndPrepareFill<'ix> {
    pub prepared_order_response_key: &'ix Pubkey,
    pub prepared_order_response: &'ix mut PreparedOrderResponse,
    pub prepared_custody_token_key: &'ix Pubkey,
    pub prepared_custody_token: &'ix TokenAccount,
    pub auction: &'ix mut Auction,
    pub fee_recipient_token_key: &'ix Pubkey,
    pub fee_recipient_token: &'ix TokenAccount,
    pub custodian_key: &'ix Pubkey,
}

pub struct SettledNone {
    pub user_amount: u64,
    pub fill: Fill,
    pub auction_settled_event: AuctionSettled,
}

pub fn settle_none_and_prepare_fill(
    accounts: SettleNoneAndPrepareFill<'_>,
    accounts_infos: &[AccountInfo],
) -> Result<SettledNone> {
    let SettleNoneAndPrepareFill {
        prepared_order_response_key,
        prepared_order_response,
        prepared_custody_token_key,
        prepared_custody_token,
        auction,
        fee_recipient_token_key,
        fee_recipient_token,
        custodian_key,
    } = accounts;
    let prepared_order_response_signer_seeds = &[
        PreparedOrderResponse::SEED_PREFIX,
        prepared_order_response.seeds.fast_vaa_hash.as_ref(),
        &[prepared_order_response.seeds.bump],
    ];
    // Pay the `fee_recipient` the base fee and init auction fee. This ensures that the protocol
    // relayer is paid for relaying slow VAAs (which requires posting the fast order VAA) that do
    // not have an associated auction.
    let fee = prepared_order_response
        .base_fee
        .saturating_add(prepared_order_response.init_auction_fee);

    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        prepared_custody_token_key,
        fee_recipient_token_key,
        prepared_order_response_key,
        &[],
        fee,
    )?;

    invoke_signed_unchecked(
        &transfer_ix,
        accounts_infos,
        &[prepared_order_response_signer_seeds],
    )?;

    // Set authority instruction
    let set_authority_ix = spl_token::instruction::set_authority(
        &spl_token::ID,
        prepared_custody_token_key,
        Some(custodian_key),
        spl_token::instruction::AuthorityType::AccountOwner,
        prepared_order_response_key,
        &[],
    )?;

    invoke_signed_unchecked(
        &set_authority_ix,
        accounts_infos,
        &[prepared_order_response_signer_seeds],
    )?;

    auction.status = AuctionStatus::Settled {
        fee,
        total_penalty: None,
    };

    let auction_settled_event = AuctionSettled {
        fast_vaa_hash: auction.vaa_hash,
        best_offer_token: Default::default(),
        base_fee_token: crate::events::SettledTokenAccountInfo {
            key: *fee_recipient_token_key,
            balance_after: fee_recipient_token.amount.saturating_add(fee),
        }
        .into(),
        with_execute: auction.target_protocol.into(),
    };
    // TryInto is safe to unwrap here because the redeemer message had to have been able to fit in
    // the prepared order response account (so it would not have exceed u32::MAX).
    let redeemer_message = std::mem::take(&mut prepared_order_response.redeemer_message)
        .try_into()
        .unwrap();
    Ok(SettledNone {
        user_amount: prepared_custody_token.amount.saturating_sub(fee),
        fill: common::messages::Fill {
            source_chain: prepared_order_response.source_chain,
            order_sender: prepared_order_response.sender,
            redeemer: prepared_order_response.redeemer,
            redeemer_message,
        },
        auction_settled_event,
    })
}
