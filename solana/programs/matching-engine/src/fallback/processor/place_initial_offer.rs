use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use bytemuck::{Pod, Zeroable};
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use solana_program::{instruction::Instruction, program::invoke_signed_unchecked};

use crate::{
    error::MatchingEngineError,
    state::{Auction, AuctionInfo, AuctionStatus, MessageProtocol},
    ID,
};

use super::FallbackMatchingEngineInstruction;

// TODO: Remove this.
pub use super::helpers::VaaMessageBodyHeader;

// TODO: Remove this struct. Just use u64.
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct PlaceInitialOfferCctpShimData {
    pub offer_price: u64,
}

// TODO: Rename to "PlaceInitialOfferCctpV2Accounts".
#[derive(Debug, Clone, PartialEq, Eq, Copy)]
pub struct PlaceInitialOfferCctpShimAccounts<'ix> {
    /// The signer account
    // TODO: Rename to "payer".
    pub signer: &'ix Pubkey,
    /// The transfer authority account
    pub transfer_authority: &'ix Pubkey,
    /// The custodian account
    pub custodian: &'ix Pubkey,
    /// The auction config account
    pub auction_config: &'ix Pubkey,
    /// The from endpoint account
    pub from_endpoint: &'ix Pubkey,
    /// The to endpoint account
    pub to_endpoint: &'ix Pubkey,
    /// The fast market order account, which will be initialized. Seeds are
    /// [FastMarketOrderState::SEED_PREFIX, auction_address.as_ref()]
    pub fast_market_order: &'ix Pubkey,
    /// The auction account, which will be initialized.
    // TODO: Rename to "new_auction".
    pub auction: &'ix Pubkey,
    /// The offer token account
    pub offer_token: &'ix Pubkey,
    /// The auction custody token account.
    // TODO: Rename to "new_auction_custody".
    pub auction_custody_token: &'ix Pubkey,
    /// The usdc token account
    pub usdc: &'ix Pubkey,
    /// The system program account
    // TODO: Remove.
    pub system_program: &'ix Pubkey,
    /// The token program account
    // TODO: Remove.
    pub token_program: &'ix Pubkey,
}

// TODO: Rename to "PlaceInitialOfferCctpV2".
#[derive(Debug, Clone, Copy)]
pub struct PlaceInitialOfferCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: PlaceInitialOfferCctpShimAccounts<'ix>,
    pub data: PlaceInitialOfferCctpShimData,
}

impl PlaceInitialOfferCctpShim<'_> {
    pub fn instruction(&self) -> Instruction {
        let PlaceInitialOfferCctpShimAccounts {
            signer: payer,
            transfer_authority,
            custodian,
            auction_config,
            from_endpoint,
            to_endpoint,
            fast_market_order,
            auction: new_auction,
            offer_token,
            auction_custody_token: new_auction_custody,
            usdc,
            system_program: _,
            token_program: _,
        } = self.accounts;

        Instruction {
            program_id: *self.program_id,
            accounts: vec![
                AccountMeta::new(*payer, true),
                AccountMeta::new_readonly(*transfer_authority, false),
                AccountMeta::new_readonly(*custodian, false),
                AccountMeta::new_readonly(*auction_config, false),
                AccountMeta::new_readonly(*from_endpoint, false),
                AccountMeta::new_readonly(*to_endpoint, false),
                AccountMeta::new_readonly(*fast_market_order, false),
                AccountMeta::new(*new_auction, false),
                AccountMeta::new(*offer_token, false),
                AccountMeta::new(*new_auction_custody, false),
                AccountMeta::new_readonly(*usdc, false),
                AccountMeta::new_readonly(solana_program::system_program::ID, false),
                AccountMeta::new_readonly(spl_token::ID, false),
            ],
            data: FallbackMatchingEngineInstruction::PlaceInitialOfferCctpShim(&self.data).to_vec(),
        }
    }
}

pub fn process(accounts: &[AccountInfo], data: &PlaceInitialOfferCctpShimData) -> Result<()> {
    // Check all accounts are valid
    super::helpers::require_min_account_infos_len(accounts, 11)?;

    // This instruction will use the payer to create the following accounts:
    // 1. Auction.
    // 2. Auction Custody Token Account.
    let payer_info = &accounts[0];

    // This transfer authority must have been delegated authority to transfer
    // USDC so it can transfer tokens to the auction custody token account.
    //
    // We will validate this transfer authority when we attempt to transfer USDC
    // to the auction's custody account.
    let _transfer_authority = &accounts[1];

    let custodian = super::helpers::try_custodian_account(
        &accounts[2],
        true, // check_if_paused
    )?;

    let auction_config = super::helpers::try_auction_config_account(
        &accounts[3],
        Some(custodian.auction_config_id),
    )?;

    let (from_endpoint_account, to_endpoint_account) =
        super::helpers::try_live_endpoint_accounts_path(&accounts[4], &accounts[5])?;

    let fast_market_order = super::helpers::try_fast_market_order_account(&accounts[6])?;

    // Verify the fast market order comes from a registered endpoint.
    // TODO: Consider moving source endpoint check when creating fast market
    // order account.
    require_eq!(
        from_endpoint_account.chain,
        fast_market_order.vaa_emitter_chain,
        MatchingEngineError::InvalidSourceRouter
    );

    if from_endpoint_account.address != fast_market_order.vaa_emitter_address {
        return Err(MatchingEngineError::InvalidSourceRouter.into());
    }

    // Verify that the target chain has a registered endpoint.
    require_eq!(
        to_endpoint_account.chain,
        fast_market_order.target_chain,
        MatchingEngineError::InvalidTargetRouter
    );

    let new_auction_info = &accounts[7];

    let vaa_sequence = fast_market_order.vaa_sequence;
    let vaa_timestamp = fast_market_order.vaa_timestamp;
    let consistency_level = fast_market_order.vaa_consistency_level;

    // Generate the VAA digest. This digest is used as the seed for the newly
    // created auction account.
    let vaa_message_digest = super::helpers::VaaMessageBodyHeader {
        consistency_level,
        timestamp: vaa_timestamp,
        sequence: vaa_sequence,
        emitter_chain: from_endpoint_account.chain,
        emitter_address: from_endpoint_account.address,
    }
    .digest(&fast_market_order);

    // Derive the expected auction account key. This key is used for the auction
    // custody token account seed.
    let (expected_auction_key, new_auction_bump) =
        Pubkey::find_program_address(&[Auction::SEED_PREFIX, &vaa_message_digest.0], &ID);

    // This account must be the USDC mint. This instruction does not refer to
    // this account explicitly. It just needs to exist so that we can create the
    // auction's custody token account.
    super::helpers::try_usdc_account(&accounts[10])?;

    // Check that the to endpoint is a valid protocol
    match to_endpoint_account.protocol {
        MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
        _ => return Err(MatchingEngineError::InvalidEndpoint.into()),
    }

    let offer_price = data.offer_price;

    // Check contents of fast_market_order
    // TODO: Use shared method that both place initial offer instructions can
    // use.
    {
        let deadline = i64::from(fast_market_order.deadline);
        let expiration = crate::VAA_AUCTION_EXPIRATION_TIME.saturating_add(vaa_timestamp.into());
        let current_time: i64 = Clock::get().unwrap().unix_timestamp;
        if !((deadline == 0 || current_time < deadline) && current_time < expiration) {
            msg!("Fast market order has expired");
            return Err(MatchingEngineError::FastMarketOrderExpired.into());
        }

        if offer_price > fast_market_order.max_fee {
            msg!("Offer price is too high");
            return Err(MatchingEngineError::OfferPriceTooHigh.into());
        }
    }

    // We will need to move USDC from the offer token account to the custody
    // token account. The custody token account will need to be created first.
    let offer_token_info = &accounts[8];
    let new_auction_custody_info = &accounts[9];

    // We will use the expected auction custody token account key to create this
    // account.
    let (expected_auction_custody_key, new_auction_custody_bump) = Pubkey::find_program_address(
        &[
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            expected_auction_key.as_ref(),
        ],
        &ID,
    );

    super::helpers::create_usdc_token_account_reliably(
        payer_info.key,
        &expected_auction_custody_key,
        new_auction_info.key,
        new_auction_custody_info.lamports(),
        accounts,
        &[&[
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            expected_auction_key.as_ref(),
            &[new_auction_custody_bump],
        ]],
    )?;

    // We will use the expected transfer authority account key to invoke the
    // SPL token transfer instruction.
    let (expected_transfer_authority_key, transfer_authority_bump) = Pubkey::find_program_address(
        &[
            TRANSFER_AUTHORITY_SEED_PREFIX,
            expected_auction_key.as_ref(),
            &offer_price.to_be_bytes(),
        ],
        &ID,
    );

    // The total amount being transferred to the auction's custody token account
    // is the order's amount and auction participant's security deposit.
    let security_deposit = fast_market_order.max_fee.saturating_add(
        crate::utils::auction::compute_notional_security_deposit(
            &auction_config,
            fast_market_order.amount_in,
        ),
    );

    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        offer_token_info.key,
        new_auction_custody_info.key,
        &expected_transfer_authority_key,
        &[],
        fast_market_order
            .amount_in
            .checked_add(security_deposit)
            .ok_or_else(|| MatchingEngineError::U64Overflow)?,
    )
    .unwrap();

    invoke_signed_unchecked(
        &transfer_ix,
        accounts,
        &[&[
            TRANSFER_AUTHORITY_SEED_PREFIX,
            expected_auction_key.as_ref(),
            &offer_price.to_be_bytes(),
            &[transfer_authority_bump],
        ]],
    )?;

    // Create the auction account and serialize its data into it.
    super::helpers::create_account_reliably(
        payer_info.key,
        &expected_auction_key,
        new_auction_info.lamports(),
        8 + Auction::INIT_SPACE,
        accounts,
        &ID,
        &[&[
            Auction::SEED_PREFIX,
            &vaa_message_digest.0,
            &[new_auction_bump],
        ]],
    )?;

    let new_auction_info_data: &mut [u8] = &mut new_auction_info.data.borrow_mut();
    let mut new_auction_cursor = std::io::Cursor::new(new_auction_info_data);

    Auction {
        bump: new_auction_bump,
        vaa_hash: vaa_message_digest.0,
        vaa_timestamp,
        target_protocol: to_endpoint_account.protocol,
        status: AuctionStatus::Active,
        prepared_by: *payer_info.key,
        info: AuctionInfo {
            config_id: auction_config.id,
            custody_token_bump: new_auction_custody_bump,
            vaa_sequence,
            source_chain: from_endpoint_account.chain,
            best_offer_token: *offer_token_info.key,
            initial_offer_token: *offer_token_info.key,
            start_slot: Clock::get().unwrap().slot,
            amount_in: fast_market_order.amount_in,
            security_deposit,
            offer_price,
            redeemer_message_len: fast_market_order.redeemer_message_length,
            destination_asset_info: Default::default(),
        }
        .into(),
    }
    .try_serialize(&mut new_auction_cursor)
}

#[cfg(test)]
mod tests {
    use crate::state::{FastMarketOrder, FastMarketOrderParams};

    use super::*;

    #[test]
    fn test_bytemuck() {
        let test_fast_market_order = FastMarketOrder::new(FastMarketOrderParams {
            amount_in: 1000000000000000000,
            min_amount_out: 1000000000000000000,
            deadline: 1000000000,
            target_chain: 1,
            redeemer_message_length: 0,
            redeemer: [0_u8; 32],
            sender: [0_u8; 32],
            refund_address: [0_u8; 32],
            max_fee: 0,
            init_auction_fee: 0,
            redeemer_message: [0_u8; 512],
            close_account_refund_recipient: Pubkey::default(),
            vaa_sequence: 0,
            vaa_timestamp: 0,
            vaa_nonce: 0,
            vaa_emitter_chain: 0,
            vaa_consistency_level: 0,
            vaa_emitter_address: [0_u8; 32],
        });
        let bytes = bytemuck::bytes_of(&test_fast_market_order);
        assert!(bytes.len() == std::mem::size_of::<FastMarketOrder>());
    }
}
