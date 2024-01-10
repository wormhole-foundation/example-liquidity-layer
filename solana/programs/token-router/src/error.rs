#[anchor_lang::prelude::error_code]
pub enum TokenRouterError {
    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x2,

    // Only the program's owner or assistant is permitted.
    #[msg("OwnerOrAssistantOnly")]
    OwnerOrAssistantOnly = 0x4,

    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x20,

    #[msg("InvalidNewOwner")]
    InvalidNewOwner = 0x22,

    /// Specified key is already the program's owner.
    #[msg("AlreadyOwner")]
    AlreadyOwner = 0x24,

    #[msg("NoTransferOwnershipRequest")]
    NoTransferOwnershipRequest = 0x26,

    #[msg("InvalidNewAssistant")]
    InvalidNewAssistant = 0x28,

    /// Only the program's pending owner is permitted.
    #[msg("NotPendingOwner")]
    NotPendingOwner = 0x2a,

    #[msg("ChainNotAllowed")]
    ChainNotAllowed = 0x40,

    /// Specified foreign contract has a bad chain ID or zero address.
    #[msg("InvalidEndpoint")]
    InvalidEndpoint = 0x42,

    #[msg("CctpRemoteTokenMessengerRequired")]
    CctpRemoteTokenMessengerRequired = 0x44,

    #[msg("InvalidCctpEndpoint")]
    InvalidCctpEndpoint = 0x46,

    #[msg("ZeroAmount")]
    ZeroAmount = 0x100,

    #[msg("RedeemerZeroAddress")]
    RedeemerZeroAddress = 0x102,
}
