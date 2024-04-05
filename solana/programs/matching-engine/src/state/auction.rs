use crate::state::AuctionParameters;
use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Default)]
pub enum AuctionStatus {
    #[default]
    NotStarted,
    Active,
    Completed {
        slot: u64,
        execute_penalty: Option<u64>,
    },
    Settled {
        base_fee: u64,
        total_penalty: Option<u64>,
    },
}

impl std::fmt::Display for AuctionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuctionStatus::NotStarted => write!(f, "NotStarted"),
            AuctionStatus::Active => write!(f, "Active"),
            AuctionStatus::Completed {
                slot,
                execute_penalty,
            } => write!(
                f,
                "Completed {{ slot: {}, execute_penalty: {:?} }}",
                slot, execute_penalty
            ),
            AuctionStatus::Settled {
                base_fee,
                total_penalty,
            } => {
                write!(
                    f,
                    "Settled {{ base_fee: {}, total_penalty: {:?} }}",
                    base_fee, total_penalty
                )
            }
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Copy)]
pub struct AuctionDestinationAssetInfo {
    pub custody_token_bump: u8,
    pub amount_out: u64,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Copy)]
pub struct AuctionInfo {
    pub config_id: u32,

    pub custody_token_bump: u8,

    /// Sequence of the fast market order VAA.
    pub vaa_sequence: u64,

    /// The chain where the transfer is initiated.
    pub source_chain: u16,

    /// The highest bidder of the auction.
    pub best_offer_token: Pubkey,

    /// The initial bidder of the auction.
    pub initial_offer_token: Pubkey,

    /// The slot when the auction started.
    pub start_slot: u64,

    /// The amount reflecting the amount of assets transferred into the matching engine. This plus
    /// and the security deposit are used to participate in the auction.
    pub amount_in: u64,

    /// The additional deposit made by the highest bidder.
    ///
    /// NOTE: This may not be the same denomination as the `amount_in`.
    pub security_deposit: u64,

    /// The offer price of the auction.
    pub offer_price: u64,

    /// If the destination asset is not equal to the asset used for auctions, this will be some
    /// value specifying its custody token bump and amount out.
    ///
    /// NOTE: Because this is an option, the `AuctionDestinationAssetInfo` having some definition while this
    /// field is None will not impact future serialization because the option's serialized value is
    /// zero. Only when there will be other assets will this struct's members have to be carefully
    /// considered.
    pub destination_asset_info: Option<AuctionDestinationAssetInfo>,
}

impl AuctionInfo {
    /// Compute start slot + duration.
    #[inline]
    pub fn auction_end_slot(&self, params: &AuctionParameters) -> u64 {
        self.start_slot + u64::from(params.duration)
    }

    /// Compute start slot + duration + grace period.
    #[inline]
    pub fn grace_period_end_slot(&self, params: &AuctionParameters) -> u64 {
        self.auction_end_slot(params) + u64::from(params.grace_period)
    }

    /// Compute start slot + duration + grace period + penalty slots.
    #[inline]
    pub fn penalty_period_end_slot(&self, params: &AuctionParameters) -> u64 {
        self.grace_period_end_slot(params) + u64::from(params.penalty_period)
    }

    /// Compute amount in + security deposit.
    #[inline]
    pub fn total_deposit(&self) -> u64 {
        self.amount_in + self.security_deposit
    }
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Auction {
    pub bump: u8,

    /// VAA hash of the auction.
    pub vaa_hash: [u8; 32],

    /// Timestamp of the fast market order VAA.
    pub vaa_timestamp: u32,

    /// Auction status.
    pub status: AuctionStatus,

    pub info: Option<AuctionInfo>,
}

impl Auction {
    pub const SEED_PREFIX: &'static [u8] = b"auction";
    pub const INIT_SPACE_NO_AUCTION: usize = Self::INIT_SPACE - AuctionInfo::INIT_SPACE;
}
