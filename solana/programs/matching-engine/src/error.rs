use anchor_lang::prelude::*;
use common::admin::utils::upgrade::RequireValidInstructionsError;

#[error_code]
pub enum MatchingEngineError {
    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x2,

    // Only the program's owner or assistant is permitted.
    #[msg("OwnerOrAssistantOnly")]
    OwnerOrAssistantOnly = 0x4,

    #[msg("CpiDisallowed")]
    CpiDisallowed = 0x8,

    #[msg("UpgradeManagerRequired")]
    UpgradeManagerRequired = 0x10,

    #[msg("SameEndpoint")]
    SameEndpoint = 0x20,

    #[msg("InvalidEndpoint")]
    InvalidEndpoint = 0x22,

    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x100,

    #[msg("FeeRecipientZeroPubkey")]
    FeeRecipientZeroPubkey = 0x101,

    #[msg("ImmutableProgram")]
    ImmutableProgram = 0x102,

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

    #[msg("Paused")]
    Paused = 0x80,

    #[msg("InvalidTokenAccount")]
    InvalidTokenAccount,

    #[msg("ChainNotAllowed")]
    ChainNotAllowed,

    #[msg("InvalidMintRecipient")]
    InvalidMintRecipient,

    #[msg("ErrInvalidSourceRouter")]
    ErrInvalidSourceRouter,

    #[msg("ErrInvalidTargetRouter")]
    ErrInvalidTargetRouter,

    #[msg("TokenRouterProgramIdRequired")]
    TokenRouterProgramIdRequired,

    #[msg("InvalidAuctionDuration")]
    InvalidAuctionDuration,

    #[msg("InvalidAuctionGracePeriod")]
    InvalidAuctionGracePeriod,

    #[msg("UserPenaltyTooLarge")]
    UserPenaltyTooLarge,

    #[msg("InitialPenaltyTooLarge")]
    InitialPenaltyTooLarge,

    #[msg("MinOfferDeltaTooLarge")]
    MinOfferDeltaTooLarge,

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

    #[msg("InvalidEmitterForFastFill")]
    InvalidEmitterForFastFill,

    #[msg("InvalidDeposit")]
    InvalidDeposit,

    #[msg("InvalidDepositMessage")]
    InvalidDepositMessage,

    #[msg("InvalidPayloadId")]
    InvalidPayloadId,

    #[msg("InvalidDepositPayloadId")]
    InvalidDepositPayloadId,

    #[msg("AuctionNotActive")]
    AuctionNotActive,

    #[msg("AuctionPeriodExpired")]
    AuctionPeriodExpired,

    #[msg("AuctionPeriodNotExpired")]
    AuctionPeriodNotExpired,

    #[msg("OfferPriceNotImproved")]
    OfferPriceNotImproved,

    #[msg("BestOfferTokenNotPassedIn")]
    BestOfferTokenNotPassedIn,

    #[msg("PenaltyCalculationFailed")]
    PenaltyCalculationFailed,

    #[msg("VaaMismatch")]
    VaaMismatch,

    #[msg("MismatchedVaaHash")]
    MismatchedVaaHash,

    #[msg("ExecutorTokenMismatch")]
    ExecutorTokenMismatch,

    #[msg("InitialOfferTokenMismatch")]
    InitialOfferTokenMismatch,

    #[msg("FeeRecipientTokenMismatch")]
    FeeRecipientTokenMismatch,

    #[msg("AuctionNotCompleted")]
    AuctionNotCompleted,

    #[msg("AuctionConfigMismatch")]
    AuctionConfigMismatch,

    #[msg("EndpointDisabled")]
    EndpointDisabled,

    #[msg("InvalidCctpEndpoint")]
    InvalidCctpEndpoint,

    #[msg("CarpingNotAllowed")]
    CarpingNotAllowed,

    #[msg("ProposalAlreadyEnacted")]
    ProposalAlreadyEnacted,

    #[msg("ProposalDelayNotExpired")]
    ProposalDelayNotExpired,

    #[msg("InvalidProposalAction")]
    InvalidProposalAction,
}

impl RequireValidInstructionsError for MatchingEngineError {
    fn require_eq_this_program(actual_program_id: Pubkey) -> Result<()> {
        require_keys_eq!(actual_program_id, crate::ID, Self::CpiDisallowed);
        Ok(())
    }

    fn require_eq_upgrade_manager(actual_program_id: Pubkey) -> Result<()> {
        require_keys_eq!(
            actual_program_id,
            common::constants::UPGRADE_MANAGER_PROGRAM_ID,
            Self::UpgradeManagerRequired
        );
        Ok(())
    }
}
