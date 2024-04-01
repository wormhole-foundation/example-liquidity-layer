#[anchor_lang::error_code]
pub enum MatchingEngineError {
    OwnerOnly = 0x2,
    OwnerOrAssistantOnly = 0x4,

    SameEndpoint = 0x20,
    InvalidEndpoint = 0x22,

    InvalidVaa = 0x30,

    InvalidDeposit = 0x42,
    InvalidDepositMessage = 0x44,
    InvalidPayloadId = 0x46,
    InvalidDepositPayloadId = 0x48,
    NotFastMarketOrder = 0x4a,
    VaaMismatch = 0x4c,

    InvalidSourceRouter = 0x60,
    InvalidTargetRouter = 0x62,
    EndpointDisabled = 0x64,
    InvalidCctpEndpoint = 0x66,

    Paused = 0x80,

    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    ImmutableProgram = 0x102,
    InvalidAuctionDuration = 0x104,
    InvalidAuctionGracePeriod = 0x106,
    UserPenaltyTooLarge = 0x108,
    InitialPenaltyTooLarge = 0x10a,
    MinOfferDeltaTooLarge = 0x10c,

    InvalidNewOwner = 0x202,
    AlreadyOwner = 0x204,
    NoTransferOwnershipRequest = 0x206,
    NotPendingOwner = 0x208,
    InvalidChain = 0x20c,

    ChainNotAllowed = 0x240,
    InvalidMintRecipient = 0x242,

    ProposalAlreadyEnacted = 0x300,
    ProposalDelayNotExpired = 0x302,

    AuctionConfigMismatch = 0x340,

    FastMarketOrderExpired = 0x400,
    OfferPriceTooHigh = 0x402,
    InvalidEmitterForFastFill = 0x406,
    AuctionNotActive = 0x408,
    AuctionPeriodExpired = 0x40a,
    AuctionPeriodNotExpired = 0x40c,
    ExecutorTokenMismatch = 0x414,
    AuctionNotCompleted = 0x41a,
    CarpingNotAllowed = 0x41e,
    AuctionNotSettled = 0x420,

    CannotCloseAuctionYet = 0x500,
    AuctionHistoryNotFull = 0x502,
    AuctionHistoryFull = 0x504,
}
