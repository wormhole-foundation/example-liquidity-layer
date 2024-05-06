#[anchor_lang::error_code]
pub enum MatchingEngineError {
    OwnerOnly = 0x2,
    OwnerOrAssistantOnly = 0x4,

    U64Overflow = 0x10,
    U32Overflow = 0x12,

    SameEndpoint = 0x20,
    InvalidEndpoint = 0x22,

    InvalidVaa = 0x30,

    InvalidDeposit = 0x42,
    InvalidDepositMessage = 0x44,
    InvalidPayloadId = 0x46,
    InvalidDepositPayloadId = 0x48,
    NotFastMarketOrder = 0x4a,
    VaaMismatch = 0x4c,
    RedeemerMessageTooLarge = 0x4e,

    InvalidSourceRouter = 0x60,
    InvalidTargetRouter = 0x62,
    EndpointDisabled = 0x64,
    InvalidCctpEndpoint = 0x66,

    Paused = 0x80,

    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    ImmutableProgram = 0x102,
    ZeroDuration = 0x104,
    ZeroGracePeriod = 0x106,
    ZeroPenaltyPeriod = 0x107,
    #[msg("Value exceeds 1000000")]
    UserPenaltyRewardBpsTooLarge = 0x108,
    #[msg("Value exceeds 1000000")]
    InitialPenaltyBpsTooLarge = 0x10a,
    #[msg("Value exceeds 1000000")]
    MinOfferDeltaBpsTooLarge = 0x10c,
    ZeroSecurityDepositBase = 0x10e,
    #[msg("Value exceeds 1000000")]
    SecurityDepositBpsTooLarge = 0x10f,

    InvalidNewOwner = 0x202,
    AlreadyOwner = 0x204,
    NoTransferOwnershipRequest = 0x206,
    NotPendingOwner = 0x208,
    InvalidChain = 0x20c,

    ChainNotAllowed = 0x240,
    InvalidMintRecipient = 0x242,

    ProposalAlreadyEnacted = 0x300,
    ProposalDelayNotExpired = 0x302,
    InvalidProposal = 0x304,

    AuctionConfigMismatch = 0x340,

    FastMarketOrderExpired = 0x400,
    OfferPriceTooHigh = 0x402,
    AuctionNotActive = 0x408,
    AuctionPeriodExpired = 0x40a,
    AuctionPeriodNotExpired = 0x40c,
    ExecutorTokenMismatch = 0x414,
    AuctionNotCompleted = 0x41a,
    CarpingNotAllowed = 0x41e,
    AuctionNotSettled = 0x420,
    ExecutorNotPreparedBy = 0x422,
    InvalidOfferToken = 0x424,
    FastFillTooLarge = 0x426,
    AuctionExists = 0x428,
    AccountNotAuction = 0x429,
    BestOfferTokenMismatch = 0x42a,
    BestOfferTokenRequired = 0x42c,
    PreparedByMismatch = 0x42e,
    PreparedOrderResponseNotRequired = 0x42f,
    AuctionConfigNotRequired = 0x430,
    BestOfferTokenNotRequired = 0x431,
    FastFillAlreadyRedeemed = 0x434,
    FastFillNotRedeemed = 0x435,

    CannotCloseAuctionYet = 0x500,
    AuctionHistoryNotFull = 0x502,
    AuctionHistoryFull = 0x504,
}

#[cfg(test)]
mod test {
    #![allow(clippy::panic)]

    use crate::FEE_PRECISION_MAX;
    use anchor_lang::prelude::*;

    use super::*;

    #[test]
    fn test_user_penalty_rewards_bps_too_large() {
        match error!(MatchingEngineError::UserPenaltyRewardBpsTooLarge) {
            Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, 6000 + 0x108);
                assert_eq!(
                    error.error_msg,
                    format!("Value exceeds {FEE_PRECISION_MAX}")
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn test_initial_penalty_bps_too_large() {
        match error!(MatchingEngineError::InitialPenaltyBpsTooLarge) {
            Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, 6000 + 0x10a);
                assert_eq!(
                    error.error_msg,
                    format!("Value exceeds {FEE_PRECISION_MAX}")
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn test_min_offer_delta_bps_too_large() {
        match error!(MatchingEngineError::MinOfferDeltaBpsTooLarge) {
            Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, 6000 + 0x10c);
                assert_eq!(
                    error.error_msg,
                    format!("Value exceeds {FEE_PRECISION_MAX}")
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn test_security_deposit_bps_too_large() {
        match error!(MatchingEngineError::SecurityDepositBpsTooLarge) {
            Error::AnchorError(error) => {
                assert_eq!(error.error_code_number, 6000 + 0x10f);
                assert_eq!(
                    error.error_msg,
                    format!("Value exceeds {FEE_PRECISION_MAX}")
                );
            }
            _ => panic!(),
        }
    }
}
