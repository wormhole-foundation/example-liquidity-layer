use anchor_lang::prelude::error_code;

#[error_code]
pub enum MatchingEngineError {
    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x100,

    #[msg("FeeRecipientZeroPubkey")]
    FeeRecipientZeroPubkey = 0x101,

    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x200,

    #[msg("InvalidNewAssistant")]
    InvalidNewAssistant = 0x208,

    #[msg("InvalidNewFeeRecipient")]
    InvalidNewFeeRecipient = 0x20a,

    #[msg("InvalidChain")]
    InvalidChain = 0x20c,

    #[msg("OwnerOrAssistantOnly")]
    // Only the program's owner or assistant is permitted.
    OwnerOrAssistantOnly,

    #[msg("ChainNotAllowed")]
    ChainNotAllowed,

    #[msg("InvalidEndpoint")]
    /// Specified foreign contract has a bad chain ID or zero address.
    InvalidEndpoint,

    #[msg("AlreadyTheFeeRecipient")]
    /// The specified account is already the fee recipient.
    AlreadyTheFeeRecipient,

    #[msg("InvalidAuctionDuration")]
    /// The auction duration is zero.
    InvalidAuctionDuration,

    #[msg("InvalidAuctionGracePeriod")]
    /// The auction grace period is less than the `auction_duration`.
    InvalidAuctionGracePeriod,

    #[msg("UserPenaltyTooLarge")]
    /// The value is larger than the maximum precision constant.
    UserPenaltyTooLarge,

    #[msg("InitialPenaltyTooLarge")]
    /// The value is larger than the maximum precision constant.
    InitialPenaltyTooLarge,
}
