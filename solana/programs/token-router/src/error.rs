#[anchor_lang::prelude::error_code]
pub enum TokenRouterError {
    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x100,

    #[msg("FeeRecipientZeroPubkey")]
    FeeRecipientZeroPubkey = 0x102,

    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x200,

    #[msg("InvalidNewOwner")]
    InvalidNewOwner = 0x202,

    /// Specified key is already the program's owner.
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

    /// Only the program's pending owner is permitted.
    #[msg("NotPendingOwner")]
    NotPendingOwner = 0x20e,

    #[msg("CctpRemoteTokenMessengerRequired")]
    CctpRemoteTokenMessengerRequired,

    #[msg("InvalidCctpEndpoint")]
    InvalidCctpEndpoint,

    #[msg("OutboundTransfersPaused")]
    /// Outbound transfers are paused.
    OutboundTransfersPaused,

    #[msg("OwnerOrAssistantOnly")]
    // Only the program's owner or assistant is permitted.
    OwnerOrAssistantOnly,

    #[msg("AlreadyTheFeeRecipient")]
    /// Specified key is already the program's fee recipient.
    AlreadyTheFeeRecipient,

    #[msg("BumpNotFound")]
    /// Bump not found in `bumps` map.
    BumpNotFound,

    #[msg("FailedToMakeImmutable")]
    /// Failed to make program immutable.
    FailedToMakeImmutable,

    #[msg("InvalidEndpoint")]
    /// Specified foreign contract has a bad chain ID or zero address.
    InvalidEndpoint,

    #[msg("ChainNotAllowed")]
    ChainNotAllowed,

    #[msg("ZeroBridgeAmount")]
    /// Nothing to transfer if amount is zero.
    ZeroBridgeAmount,

    #[msg("InvalidToNativeAmount")]
    /// Must be strictly zero or nonzero when normalized.
    InvalidToNativeAmount,

    #[msg("NativeMintRequired")]
    /// Must be the native mint.
    NativeMintRequired,

    #[msg("SwapsNotAllowedForNativeMint")]
    /// Swaps are not allowed for the native mint.
    SwapsNotAllowedForNativeMint,

    #[msg("InvalidTokenBridgeConfig")]
    /// Specified Token Bridge config PDA is wrong.
    InvalidTokenBridgeConfig,

    #[msg("InvalidTokenBridgeAuthoritySigner")]
    /// Specified Token Bridge authority signer PDA is wrong.
    InvalidTokenBridgeAuthoritySigner,

    #[msg("InvalidTokenBridgeCustodySigner")]
    /// Specified Token Bridge custody signer PDA is wrong.
    InvalidTokenBridgeCustodySigner,

    #[msg("InvalidTokenBridgeEmitter")]
    /// Specified Token Bridge emitter PDA is wrong.
    InvalidTokenBridgeEmitter,

    #[msg("InvalidTokenBridgeSequence")]
    /// Specified Token Bridge sequence PDA is wrong.
    InvalidTokenBridgeSequence,

    #[msg("InvalidRecipient")]
    /// Specified recipient has a bad chain ID or zero address.
    InvalidRecipient,

    #[msg("InvalidTransferToChain")]
    /// Deserialized token chain is invalid.
    InvalidTransferToChain,

    #[msg("InvalidTransferTokenChain")]
    /// Deserialized recipient chain is invalid.
    InvalidTransferTokenChain,

    #[msg("InvalidPrecision")]
    /// Relayer fee and swap rate precision must be nonzero.
    InvalidPrecision,

    #[msg("InvalidTransferToAddress")]
    /// Deserialized recipient must be this program or the redeemer PDA.
    InvalidTransferToAddress,

    #[msg("AlreadyRedeemed")]
    /// Token Bridge program's transfer is already redeemed.
    AlreadyRedeemed,

    #[msg("InvalidTokenBridgeForeignEndpoint")]
    /// Token Bridge program's foreign endpoint disagrees with registered one.
    InvalidTokenBridgeForeignEndpoint,

    #[msg("InvalidTokenBridgeMintAuthority")]
    /// Specified Token Bridge mint authority PDA is wrong.
    InvalidTokenBridgeMintAuthority,

    #[msg("InvalidPublicKey")]
    /// Pubkey is the default.
    InvalidPublicKey,

    #[msg("ZeroSwapRate")]
    /// Swap rate is zero.
    ZeroSwapRate,

    #[msg("TokenNotRegistered")]
    /// Token is not registered.
    TokenNotRegistered,

    #[msg("ChainNotRegistered")]
    /// Foreign contract not registered for specified chain.
    ChainNotRegistered,

    #[msg("TokenAlreadyRegistered")]
    /// Token is already registered.
    TokenAlreadyRegistered,

    #[msg("TokenFeeCalculationError")]
    /// Token fee overflow.
    FeeCalculationError,

    #[msg("InvalidSwapCalculation")]
    /// Swap calculation overflow.
    InvalidSwapCalculation,

    #[msg("InsufficientFunds")]
    /// Insufficient funds for outbound transfer.
    InsufficientFunds,
}
