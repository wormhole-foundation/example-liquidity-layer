use anchor_lang::prelude::*;

// TODO: Move these into the matching engine error code enum
#[error_code]
pub enum FallbackError {
    #[msg("Account is already initialized")]
    AccountAlreadyInitialized,

    #[msg("From and to endpoints are the same")]
    SameEndpoints,

    #[msg("Invalid PDA")]
    InvalidPda,

    #[msg("Account data too small")]
    AccountDataTooSmall,

    #[msg("Borsh Deserialization Error")]
    BorshDeserializationError,

    #[msg("Invalid mint")]
    InvalidMint,

    #[msg("Account not writable")]
    AccountNotWritable,

    #[msg("Token transfer failed")]
    TokenTransferFailed,

    #[msg("Invalid CCTP message")]
    InvalidCctpMessage,

    #[msg("Invalid program")]
    InvalidProgram,
}
