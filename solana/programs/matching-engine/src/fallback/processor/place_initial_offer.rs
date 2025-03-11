use anchor_lang::prelude::*;
use anchor_spl::token::spl_token;
use bytemuck::{Pod, Zeroable};
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed_unchecked;
use super::create_account::create_account_reliably;
use solana_program::keccak;
use anchor_lang::Discriminator;
use solana_program::program_pack::Pack;
use crate::state::{Auction, AuctionConfig, AuctionInfo, AuctionStatus, Custodian, FastMarketOrder as FastMarketOrderState, MessageProtocol, RouterEndpoint};
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use crate::ID as PROGRAM_ID;

use super::FallbackMatchingEngineInstruction;
use super::errors::FallbackError;
use crate::error::MatchingEngineError;

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct PlaceInitialOfferCctpShimData {
    pub offer_price: u64,
    pub sequence: u64,
    pub vaa_time: u32,
    pub consistency_level: u8,
    _padding: [u8; 3],
}

impl PlaceInitialOfferCctpShimData {

    pub fn new(offer_price: u64, sequence: u64, vaa_time: u32, consistency_level: u8) -> Self {
        Self { offer_price, sequence, vaa_time, consistency_level, _padding: [0_u8; 3] }
    }

    pub fn from_bytes(data: &[u8]) -> Option<&Self> {
       bytemuck::try_from_bytes::<Self>(data).ok()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Copy)]
pub struct PlaceInitialOfferCctpShimAccounts<'ix> {
    pub signer: &'ix Pubkey,
    pub transfer_authority: &'ix Pubkey,
    pub custodian: &'ix Pubkey,
    pub auction_config: &'ix Pubkey,
    pub from_endpoint: &'ix Pubkey,
    pub to_endpoint: &'ix Pubkey,
    pub fast_market_order: &'ix Pubkey, // Needs initalising. Seeds are [FastMarketOrderState::SEED_PREFIX, auction_address.as_ref()]
    pub auction: &'ix Pubkey, // Needs initalising
    pub offer_token: &'ix Pubkey,
    pub auction_custody_token: &'ix Pubkey,
    pub usdc: &'ix Pubkey,
    pub system_program: &'ix Pubkey,
    pub token_program: &'ix Pubkey,
}

impl<'ix> PlaceInitialOfferCctpShimAccounts<'ix> {
    pub fn to_account_metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(*self.signer, true),
            AccountMeta::new_readonly(*self.transfer_authority, false),
            AccountMeta::new_readonly(*self.custodian, false),
            AccountMeta::new_readonly(*self.auction_config, false),
            AccountMeta::new_readonly(*self.from_endpoint, false),
            AccountMeta::new_readonly(*self.to_endpoint, false),
            AccountMeta::new(*self.fast_market_order, false),
            AccountMeta::new(*self.auction, false),
            AccountMeta::new(*self.offer_token, false),
            AccountMeta::new(*self.auction_custody_token, false),
            AccountMeta::new_readonly(*self.usdc, false),
            AccountMeta::new_readonly(*self.system_program, false),
            AccountMeta::new_readonly(*self.token_program, false),
        ]
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PlaceInitialOfferCctpShim<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: PlaceInitialOfferCctpShimAccounts<'ix>,
    pub data: PlaceInitialOfferCctpShimData,
}

impl PlaceInitialOfferCctpShim<'_> {
    pub fn instruction(&self) -> Instruction {
        Instruction {
            program_id: *self.program_id,
            accounts: self.accounts.to_account_metas(),
            data: FallbackMatchingEngineInstruction::PlaceInitialOfferCctpShim(&self.data).to_vec(),
        }
    }
}

#[derive(Debug)]
pub struct VaaMessageBodyHeader {
    pub consistency_level: u8,
    pub vaa_time: u32,
    pub nonce: u32,
    pub sequence: u64,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
}

impl VaaMessageBodyHeader {
    pub fn new(consistency_level: u8, vaa_time: u32, sequence: u64, emitter_chain: u16, emitter_address: [u8; 32]) -> Self {
        Self { consistency_level, vaa_time, nonce: 0, sequence, emitter_chain, emitter_address }
    }

    /// This function creates both the message body and the payload. 
    /// This is all done here just because it's (supposedly?) cheaper in the solana vm.
    pub fn message_body(&self, fast_market_order: &FastMarketOrderState) -> Vec<u8> {
        let mut message_body = vec![];
        message_body.extend_from_slice(&self.vaa_time.to_be_bytes());
        message_body.extend_from_slice(&self.nonce.to_be_bytes());
        message_body.extend_from_slice(&self.emitter_chain.to_be_bytes());
        message_body.extend_from_slice(&self.emitter_address);
        message_body.extend_from_slice(&self.sequence.to_be_bytes());
        message_body.extend_from_slice(&[self.consistency_level]);
        let mut payload = vec![];
        payload.push(11_u8);
        payload.extend_from_slice(&fast_market_order.amount_in.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.min_amount_out.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.target_chain.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.redeemer);
        payload.extend_from_slice(&fast_market_order.sender);
        payload.extend_from_slice(&fast_market_order.refund_address);
        payload.extend_from_slice(&fast_market_order.max_fee.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.init_auction_fee.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.deadline.to_be_bytes());
        payload.extend_from_slice(&fast_market_order.redeemer_message_length.to_be_bytes());
        if fast_market_order.redeemer_message_length > 0 {
            payload.extend_from_slice(&fast_market_order.redeemer_message[..fast_market_order.redeemer_message_length as usize]);
        }
        message_body.extend_from_slice(&payload);
        message_body
    }

    pub fn message_hash(&self, fast_market_order: &FastMarketOrderState) -> keccak::Hash {
        keccak::hashv(&[
            self.message_body(fast_market_order).as_ref()
        ])
    }

    pub fn digest(&self, fast_market_order: &FastMarketOrderState) -> keccak::Hash {
        keccak::hashv(&[self.message_hash(fast_market_order).as_ref()])
    }

    pub fn vaa_time(&self) -> u32 {
        self.vaa_time
    }

    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn emitter_chain(&self) -> u16 {
        self.emitter_chain
    }
}

pub fn place_initial_offer_cctp_shim(accounts: &[AccountInfo], data: &PlaceInitialOfferCctpShimData) -> Result<()> {
    // Check account owners
    let program_id = &crate::ID; // Your program ID
    
    // Check all accounts are valid
    if accounts.len() < 11 {
        return Err(ErrorCode::AccountNotEnoughKeys.into());
    }
    // Extract data fields
    // TODO: Remove sequence, vaa_time because they are in the fast market order state
    let PlaceInitialOfferCctpShimData {
        offer_price,
        sequence,
        vaa_time,
        consistency_level,
        _padding,
    } = *data;

    let signer = &accounts[0];
    let transfer_authority = &accounts[1];
    let custodian = &accounts[2];
    let auction_config = &accounts[3];
    let from_endpoint = &accounts[4];
    let to_endpoint = &accounts[5];
    let fast_market_order_account = &accounts[6];
    let auction_account = &accounts[7];
    let auction_key = auction_account.key();
    let offer_token = &accounts[8];
    let auction_custody_token = &accounts[9];
    let usdc = &accounts[10];
    

    let fast_market_order_zero_copy = FastMarketOrderState::try_deserialize(&mut &fast_market_order_account.data.borrow()[..])?;

    // Check pda of the transfer authority is valid
    let transfer_authority_seeds = [
        TRANSFER_AUTHORITY_SEED_PREFIX,
        auction_key.as_ref(),
        &offer_price.to_be_bytes()
    ];
    let (transfer_authority_pda, transfer_authority_bump) = Pubkey::find_program_address(&transfer_authority_seeds, &PROGRAM_ID);
    if transfer_authority_pda != transfer_authority.key() {
        msg!("Transfer authority pda is invalid");
        return Err(ErrorCode::ConstraintSeeds.into())
            .map_err(|e: Error| e.with_pubkeys((transfer_authority_pda, transfer_authority.key())));
    }

    // Check custodian owner
    if custodian.owner != program_id {
        msg!("Custodian owner is invalid: expected {}, got {}", program_id, custodian.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("custodian"));
    }
    // Check custodian is not paused
    let checked_custodian = Custodian::try_deserialize(&mut &custodian.data.borrow()[..])?;
    if checked_custodian.paused {
        msg!("Custodian is paused");
        return Err(ErrorCode::ConstraintRaw.into())
            .map_err(|e: Error| e.with_account_name("custodian"));
    }
    // Check auction_config owner
    if auction_config.owner != program_id {
        msg!("Auction config owner is invalid: expected {}, got {}", program_id, auction_config.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("auction_config"));
    }

    // Check auction config id is correct corresponding to the custodian
    let auction_config_account = AuctionConfig::try_deserialize(&mut &auction_config.data.borrow()[..])?;
    if auction_config_account.id != checked_custodian.auction_config_id {
        msg!("Auction config id is invalid");
        return Err(ErrorCode::ConstraintRaw.into())
            .map_err(|e: Error| e.with_account_name("auction_config"));
    }
    
    // Check usdc mint
    if usdc.key() != common::USDC_MINT {
        msg!("Usdc mint is invalid");
        return Err(FallbackError::InvalidMint.into());
    }
    
    // Check from_endpoint owner
    if from_endpoint.owner != program_id {
        msg!("From endpoint owner is invalid: expected {}, got {}", program_id, from_endpoint.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("from_endpoint"));
    }
    
    // Deserialise the from_endpoint account
    let from_endpoint_account = RouterEndpoint::try_deserialize(&mut &from_endpoint.data.borrow()[..])?;
    
    // Check to_endpoint owner
    if to_endpoint.owner != program_id {
        msg!("To endpoint owner is invalid: expected {}, got {}", program_id, to_endpoint.owner);
        return Err(ErrorCode::ConstraintOwner.into())
            .map_err(|e: Error| e.with_account_name("to_endpoint"));
    }
    
    // Deserialise the to_endpoint account
    let to_endpoint_account = RouterEndpoint::try_deserialize(&mut &to_endpoint.data.borrow()[..])?;
    
    // Check that the from and to endpoints are different
    if from_endpoint_account.chain == to_endpoint_account.chain {
        return Err(MatchingEngineError::SameEndpoint.into());
    }
    
    // Check that the to endpoint protocol is cctp or local
    match to_endpoint_account.protocol {
        MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
        _ => return Err(MatchingEngineError::InvalidEndpoint.into()),
    }
    
    // Check that the from endpoint protocol is cctp or local
    match from_endpoint_account.protocol {
        MessageProtocol::Cctp { .. } | MessageProtocol::Local { .. } => (),
        _ => return Err(MatchingEngineError::InvalidEndpoint.into()),
    }

    // Check that to endpoint chain is equal to the fast_market_order target_chain
    if to_endpoint_account.chain != fast_market_order_zero_copy.target_chain {
        msg!("To endpoint chain is not equal to the fast_market_order target_chain");
        return Err(MatchingEngineError::InvalidTargetRouter.into());
    }

    // Check contents of fast_market_order
    {
        let deadline = fast_market_order_zero_copy.deadline as i64;
        let expiration = i64::from(vaa_time).saturating_add(crate::VAA_AUCTION_EXPIRATION_TIME);
        let current_time = Clock::get().unwrap().unix_timestamp;
        if !((deadline == 0 || current_time < deadline) && current_time < expiration) {
            msg!("Fast market order has expired");
            return Err(MatchingEngineError::FastMarketOrderExpired.into());
        }

        if offer_price > fast_market_order_zero_copy.max_fee {
            msg!("Offer price is too high");
            return Err(MatchingEngineError::OfferPriceTooHigh.into());
        }
    }
    
    // Create the vaa_message struct to get the digest
    let vaa_message = VaaMessageBodyHeader::new(consistency_level, vaa_time, sequence, from_endpoint_account.chain, from_endpoint_account.address);
    let vaa_message_digest = vaa_message.digest(&fast_market_order_zero_copy);

    // Begin of initialisation of auction custody token account
    // ------------------------------------------------------------------------------------------------
    let auction_custody_token_space = spl_token::state::Account::LEN;

    let (auction_custody_token_pda, auction_custody_token_bump) = Pubkey::find_program_address(&[crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX, auction_key.as_ref()], &program_id);
    if auction_custody_token_pda != auction_custody_token.key() {
        msg!("Auction custody token pda is invalid. Passed account: {}, expected: {}", auction_custody_token.key(), auction_custody_token_pda);
        return Err(FallbackError::InvalidPda.into());
    }
    
    let auction_custody_token_seeds = [
        crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
        auction_key.as_ref(),
        &[auction_custody_token_bump],
    ];
    let auction_custody_token_signer_seeds = &[&auction_custody_token_seeds[..]];
    create_account_reliably(
        &signer.key(),
        &auction_custody_token_pda,
        auction_custody_token.lamports(),
        auction_custody_token_space,
        accounts,
        &spl_token::ID,
        auction_custody_token_signer_seeds,
    )?;
    // Initialise the token account
    let init_token_account_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        &auction_custody_token_pda,
        &usdc.key(),
        &auction_account.key(),
    ).unwrap();
    
    solana_program::program::invoke(
        &init_token_account_ix,
        accounts,
    ).unwrap();
    
    // ------------------------------------------------------------------------------------------------
    // End of initialisation of auction custody token account


    // Begin of initialisation of auction account
    // ------------------------------------------------------------------------------------------------
    let auction_space = 8 + Auction::INIT_SPACE;
    let (pda, bump) = Pubkey::find_program_address(
        &[
            Auction::SEED_PREFIX,
            vaa_message_digest.as_ref(),
        ],
        &program_id,
    );

    if pda != auction_key {
        msg!("Auction pda is invalid");
        return Err(FallbackError::InvalidPda.into());
    }
    let auction_seeds = [
        Auction::SEED_PREFIX,
        vaa_message_digest.as_ref(),
        &[bump],
    ];
    let auction_signer_seeds = &[&auction_seeds[..]];
    create_account_reliably(
        &signer.key(),
        &auction_key,
        auction_account.lamports(),
        auction_space,
        accounts,
        &program_id,
        auction_signer_seeds,
    )?;
    // Borrow the account data mutably
    let mut data = auction_account.try_borrow_mut_data().map_err(|_| FallbackError::AccountNotWritable)?;

    // Write the discriminator to the first 8 bytes
    let discriminator = Auction::discriminator();
    data[0..8].copy_from_slice(&discriminator);

    let security_deposit = fast_market_order_zero_copy.max_fee
            .saturating_add(crate::utils::auction::compute_notional_security_deposit(
                &auction_config_account.parameters,
                fast_market_order_zero_copy.amount_in,
            ));

    let auction_to_write = Auction {
        bump,
        vaa_hash: vaa_message.digest(&fast_market_order_zero_copy).as_ref().try_into().unwrap(),
        vaa_timestamp: vaa_message.vaa_time(),
        target_protocol: to_endpoint_account.protocol,
        status: AuctionStatus::Active,
        prepared_by: signer.key(),
        info: AuctionInfo {
            config_id: auction_config_account.id,
            custody_token_bump: auction_custody_token_bump,
            vaa_sequence: vaa_message.sequence(),
            source_chain: vaa_message.emitter_chain(),
            best_offer_token: offer_token.key(),
            initial_offer_token: offer_token.key(),
            start_slot: Clock::get().unwrap().slot,
            amount_in: fast_market_order_zero_copy.amount_in,
            security_deposit,
            offer_price,
            redeemer_message_len: fast_market_order_zero_copy.redeemer_message_length,
            destination_asset_info: Default::default(),
        }
        .into(),
    };
    // Write the auction struct to the account
    let auction_bytes = auction_to_write.try_to_vec().map_err(|_| FallbackError::BorshDeserializationError)?;
    data[8..8 + auction_bytes.len()].copy_from_slice(&auction_bytes);
    // ------------------------------------------------------------------------------------------------
    // End of initialisation of auction account
    
    // Start of token transfer from offer token to auction custody token
    // ------------------------------------------------------------------------------------------------

    let transfer_ix = spl_token::instruction::transfer(
        &spl_token::ID,
        &offer_token.key(),
        &auction_custody_token.key(),
        &transfer_authority.key(),
        &[], // Apparently this is only for multi-sig accounts
        fast_market_order_zero_copy.amount_in
            .checked_add(security_deposit)
            .ok_or_else(|| MatchingEngineError::U64Overflow)?
    ).unwrap();
    invoke_signed_unchecked(&transfer_ix, accounts, &[&[
        TRANSFER_AUTHORITY_SEED_PREFIX,
        auction_key.as_ref(),
        &offer_price.to_be_bytes(),
        &[transfer_authority_bump],
    ]]).map_err(|_| FallbackError::TokenTransferFailed)?;
    // ------------------------------------------------------------------------------------------------
    // End of token transfer from offer token to auction custody token
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bytemuck() {
        let test_fast_market_order = FastMarketOrderState::new(
            1000000000000000000,
            1000000000000000000,
            1000000000,
            1,
            0,
            [0_u8; 32],
            [0_u8; 32],
            [0_u8; 32],
            0,
            0,
            [0_u8; 512],
            [0_u8; 32],
            [0_u8; 32],
            0,
            0,
            0,
            [0_u8; 32],
           
        );
        let bytes = bytemuck::bytes_of(&test_fast_market_order);
        assert!(bytes.len() == std::mem::size_of::<FastMarketOrderState>());
    }
    
}
