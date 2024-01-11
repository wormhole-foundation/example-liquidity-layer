#[anchor_lang::prelude::error_code]
pub enum MatchingEngineError {
    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x100,

    #[msg("FeeRecipientZeroPubkey")]
    FeeRecipientZeroPubkey = 0x101,

    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x200,

    #[msg("InvalidNewOwner")]
    InvalidNewOwner = 0x202,

    #[msg("AlreadyOwner")]
    AlreadyOwner = 0x204,

    #[msg("NoTransferOwnershipRequest")]
    NoTransferOwnershipRequest = 0x206,

    #[msg("InvalidNewAssistant")]
    InvalidNewAssistant = 0x208,

    #[msg("InvalidNewFeeRecipient")]
    InvalidNewFeeRecipient = 0x20a,

    #[msg("InvalidChain")]
    InvalidChain = 0x20c,

    #[msg("NotPendingOwner")]
    NotPendingOwner = 0x20e,

    #[msg("OwnerOrAssistantOnly")]
    OwnerOrAssistantOnly,

    #[msg("ChainNotAllowed")]
    ChainNotAllowed,

    #[msg("InvalidEndpoint")]
    InvalidEndpoint,

    #[msg("InvalidAuctionDuration")]
    InvalidAuctionDuration,

    #[msg("InvalidAuctionGracePeriod")]
    InvalidAuctionGracePeriod,

    #[msg("UserPenaltyTooLarge")]
    UserPenaltyTooLarge,

    #[msg("InitialPenaltyTooLarge")]
    InitialPenaltyTooLarge,

    #[msg("InvalidVaa")]
    InvalidVaa,

    #[msg("NotFastMarketOrder")]
    NotFastMarketOrder,

    #[msg("FastMarketOrderExpired")]
    FastMarketOrderExpired,

    #[msg("OfferPriceTooHigh")]
    OfferPriceTooHigh,

    #[msg("AuctionAlreadyStarted")]
    AuctionAlreadyStarted,
}
