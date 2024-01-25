use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum AuctionStatus {
    NotStarted,
    Active,
    Completed { slot: u64 },
    Settled { base_fee: u64, penalty: Option<u64> },
}

impl std::fmt::Display for AuctionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuctionStatus::NotStarted => write!(f, "NotStarted"),
            AuctionStatus::Active => write!(f, "Active"),
            AuctionStatus::Completed { slot } => write!(f, "Completed {{ slot: {} }}", slot),
            AuctionStatus::Settled { base_fee, penalty } => {
                write!(
                    f,
                    "Settled {{ base_fee: {}, penalty: {:?} }}",
                    base_fee, penalty
                )
            }
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct AuctionInfo {
    pub config_id: u32,

    /// The highest bidder of the auction.
    pub best_offer_token: Pubkey,

    /// The initial bidder of the auction.
    pub initial_offer_token: Pubkey,

    /// The slot when the auction started.
    pub start_slot: u64,

    // TODO: remove
    pub end_slot: u64,

    pub amount_in: u64,

    /// The additional deposit made by the highest bidder.
    pub security_deposit: u64,

    /// The offer price of the auction.
    pub offer_price: u64,

    /// The amount of tokens to be sent to the user.
    pub amount_out: u64,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Auction {
    pub bump: u8,

    /// VAA hash of the auction.
    pub vaa_hash: [u8; 32],

    /// Auction status.
    pub status: AuctionStatus,

    pub info: Option<AuctionInfo>,
}

impl Auction {
    pub const SEED_PREFIX: &'static [u8] = b"auction";
    pub const INIT_SPACE_NO_AUCTION: usize = Self::INIT_SPACE - AuctionInfo::INIT_SPACE;
}
