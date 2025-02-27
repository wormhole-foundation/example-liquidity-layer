use crate::{
    composite::*,
    error::MatchingEngineError,
    state::{Auction, AuctionConfig, FastMarketOrder as FastMarketOrderState},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::TRANSFER_AUTHORITY_SEED_PREFIX;
use solana_program::keccak;


#[derive(Accounts)]
#[instruction(offer_price: u64, guardian_set_bump: u8, vaa_message: VaaMessage)]
pub struct PlaceInitialOfferCctpShim<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// The auction participant needs to set approval to this PDA.
    ///
    /// CHECK: Seeds must be \["transfer-authority", auction.key(), offer_price.to_be_bytes()\].
    #[account(
        seeds = [
            TRANSFER_AUTHORITY_SEED_PREFIX,
            auction.key().as_ref(),
            &offer_price.to_be_bytes()
        ],
        bump
    )]
    transfer_authority: UncheckedAccount<'info>,

    /// NOTE: This account is only used to pause inbound auctions.
    #[account(constraint = !custodian.paused @ MatchingEngineError::Paused)]
    custodian: CheckedCustodian<'info>,

    #[account(
        constraint = {
            require_eq!(
                auction_config.id,
                custodian.auction_config_id,
                MatchingEngineError::AuctionConfigMismatch,
            );

            true
        }
    )]
    auction_config: Account<'info, AuctionConfig>,

    /// The cpi instruction will verify the hash of the fast order path so no account constraints are needed.
    fast_order_path_shim: FastOrderPathShim<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + std::mem::size_of::<FastMarketOrderState>(),
        //      │   └─ FastMarketOrderState account data size
        //      └─ Anchor discriminator (8 bytes)
        seeds = [
            FastMarketOrderState::SEED_PREFIX,
            vaa_message.digest().as_ref(),
            // TODO: consider different seed
        ],
        bump
    )]
    fast_market_order: AccountLoader<'info, FastMarketOrderState>,

    /// This account should only be created once, and should never be changed to
    /// init_if_needed. Otherwise someone can game an existing auction.
    #[account(
        init,
        payer = payer,
        space = 8 + Auction::INIT_SPACE,
        seeds = [
            Auction::SEED_PREFIX,
            vaa_message.digest().as_ref(),
        ],
        bump
    )]
    auction: Box<Account<'info, Auction>>,

    #[account(mut)]
    offer_token: Box<Account<'info, token::TokenAccount>>,

    #[account(
        init,
        payer = payer,
        token::mint = usdc,
        token::authority = auction,
        seeds = [
            crate::AUCTION_CUSTODY_TOKEN_SEED_PREFIX,
            auction.key().as_ref(),
        ],
        bump,
    )]
    auction_custody_token: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,
    
    #[account(constraint = {
        require_eq!(
            verify_vaa_shim_program.key(),
            wormhole_svm_definitions::solana::VERIFY_VAA_SHIM_PROGRAM_ID,
            MatchingEngineError::InvalidVerifyVaaShimProgram
        );

        true
    })]
    verify_vaa_shim_program: UncheckedAccount<'info>,
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
}

// TODO: Change this to be PlaceInitialOfferArgs and go from there ... 
/// A vaa message is the serialised message body of a posted vaa. Only the fields that are required to create the digest are included.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct VaaMessage(pub Vec<u8>);

impl VaaMessage {
    pub fn new(consistency_level: u8, vaa_time: u32, sequence: u64, emitter_chain: u16, emitter_address: [u8; 32], payload: Vec<u8>) -> Self {
        Self(VaaMessageBody::new(consistency_level, vaa_time, sequence, emitter_chain, emitter_address, payload).to_vec())
    }

    pub fn from_vec(vec: Vec<u8>) -> Self {
        Self(vec)
    }

    fn message_hash(&self) -> keccak::Hash {
        keccak::hashv(&[self.0.as_ref()])
    }

    pub fn digest(&self) -> keccak::Hash {
        keccak::hashv(&[self.message_hash().as_ref()])
    }

    #[allow(dead_code)]
    fn nonce(&self) -> u32 {
        // nonce is the next 4 bytes of the message
        u32::from_be_bytes(self.0[4..8].try_into().unwrap())
    }

    pub fn emitter_chain(&self) -> u16 {
        // emitter_chain is the next 2 bytes of the message
        u16::from_be_bytes(self.0[8..10].try_into().unwrap())
    }

    pub fn emitter_address(&self) -> [u8; 32] {
        // emitter_address is the next 32 bytes of the message
        self.0[10..42].try_into().unwrap()
    }

}

/// Just a helper struct to make the code more readable.
struct VaaMessageBody {

    /// Level of consistency requested by the emitter
    pub consistency_level: u8,

    /// Time the vaa was submitted
    pub vaa_time: u32,

    /// Unique nonce for this message
    pub nonce: u32,

    /// Sequence number of this message
    pub sequence: u64,

    /// Emitter of the message
    pub emitter_chain: u16,

    /// Emitter of the message
    pub emitter_address: [u8; 32],

    /// Message payload
    pub payload: Vec<u8>,
}

impl VaaMessageBody {
    pub fn new(consistency_level: u8, vaa_time: u32, sequence: u64, emitter_chain: u16, emitter_address: [u8; 32], payload: Vec<u8>) -> Self {
        Self {
            consistency_level,
            vaa_time,
            nonce: 0, // Always 0
            sequence,
            emitter_chain, // Can be taken from the live router path
            emitter_address, // Can be taken from the live router path
            payload,
        }
    }

    fn to_vec(&self) -> Vec<u8> {
        vec![
            self.vaa_time.to_be_bytes().as_ref(),
            self.nonce.to_be_bytes().as_ref(),
            self.emitter_chain.to_be_bytes().as_ref(),
            &self.emitter_address,
            &self.sequence.to_be_bytes(),
            &[self.consistency_level],
            self.payload.as_ref(),
        ].concat()
    }
}