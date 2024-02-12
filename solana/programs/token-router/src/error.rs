use anchor_lang::prelude::*;
use common::admin::utils::upgrade::RequireValidInstructionsError;

#[error_code]
pub enum TokenRouterError {
    /// Only the program's owner is permitted.
    #[msg("OwnerOnly")]
    OwnerOnly = 0x2,

    // Only the program's owner or assistant is permitted.
    #[msg("OwnerOrAssistantOnly")]
    OwnerOrAssistantOnly = 0x4,

    #[msg("InvalidCustodyToken")]
    InvalidCustodyToken = 0x6,

    #[msg("CpiDisallowed")]
    CpiDisallowed = 0x8,

    #[msg("UpgradeManagerRequired")]
    UpgradeManagerRequired = 0x10,

    #[msg("AssistantZeroPubkey")]
    AssistantZeroPubkey = 0x20,

    #[msg("ImmutableProgram")]
    ImmutableProgram = 0x21,

    #[msg("InvalidNewOwner")]
    InvalidNewOwner = 0x22,

    #[msg("NotUsdc")]
    NotUsdc = 0x23,

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

    #[msg("InvalidMintRecipient")]
    InvalidMintRecipient = 0x43,

    #[msg("CctpRemoteTokenMessengerRequired")]
    CctpRemoteTokenMessengerRequired = 0x44,

    #[msg("InvalidCctpEndpoint")]
    InvalidCctpEndpoint = 0x46,

    #[msg("Paused")]
    Paused = 0x80,

    #[msg("InsufficientAmount")]
    InsufficientAmount = 0x100,

    #[msg("MinAmountOutTooHigh")]
    MinAmountOutTooHigh = 0x102,

    #[msg("PreparedByMismatch")]
    PreparedByMismatch = 0x120,

    #[msg("OrderSenderMismatch")]
    OrderSenderMismatch = 0x122,

    #[msg("RefundTokenMismatch")]
    RefundTokenMismatch = 0x124,

    #[msg("PayerNotPreparer")]
    PayerNotPreparer = 0x126,

    #[msg("InvalidSourceRouter")]
    InvalidSourceRouter = 0x200,

    #[msg("InvalidVaa")]
    InvalidVaa = 0x201,

    #[msg("InvalidDepositMessage")]
    InvalidDepositMessage = 0x202,

    #[msg("InvalidPayloadId")]
    InvalidPayloadId = 0x204,

    #[msg("InvalidRedeemer")]
    InvalidRedeemer = 0x206,

    #[msg("RedeemerMismatch")]
    RedeemerMismatch = 0x220,
}

impl RequireValidInstructionsError for TokenRouterError {
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
