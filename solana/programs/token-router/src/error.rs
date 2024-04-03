#[anchor_lang::error_code]
pub enum TokenRouterError {
    OwnerOnly = 0x2,
    OwnerOrAssistantOnly = 0x4,

    InvalidVaa = 0x30,

    InvalidDepositMessage = 0x44,
    InvalidPayloadId = 0x46,

    InvalidSourceRouter = 0x60,
    InvalidTargetRouter = 0x62,
    EndpointDisabled = 0x64,
    InvalidCctpEndpoint = 0x66,

    Paused = 0x80,

    AssistantZeroPubkey = 0x100,
    ImmutableProgram = 0x102,

    InvalidNewOwner = 0x202,
    AlreadyOwner = 0x204,
    NoTransferOwnershipRequest = 0x206,
    NotPendingOwner = 0x208,

    InsufficientAmount = 0x400,
    MinAmountOutTooHigh = 0x402,
    InvalidRedeemer = 0x404,
    RedeemerMismatch = 0x406,
    PreparedByMismatch = 0x408,
    OrderSenderMismatch = 0x40a,
    RefundTokenMismatch = 0x40c,
    PayerNotPreparer = 0x40e,
}
