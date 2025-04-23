use wormhole_svm_definitions::make_anchor_discriminator;

use crate::data::{
    InitialiseFastMarketOrderData, PlaceInitialOfferCctpShimData, PrepareOrderResponseCctpShimData,
};

/// Enum representing all possible instructions for the Fallback Matching Engine
pub enum FallbackMatchingEngineInstruction<'ix> {
    InitialiseFastMarketOrder(&'ix InitialiseFastMarketOrderData),
    CloseFastMarketOrder,
    PlaceInitialOfferCctpShim(&'ix PlaceInitialOfferCctpShimData),
    ExecuteOrderCctpShim,
    PrepareOrderResponseCctpShim(PrepareOrderResponseCctpShimData),
}

impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub const INITIALISE_FAST_MARKET_ORDER_SELECTOR: [u8; 8] =
        make_anchor_discriminator(b"global:initialise_fast_market_order");
    pub const CLOSE_FAST_MARKET_ORDER_SELECTOR: [u8; 8] =
        make_anchor_discriminator(b"global:close_fast_market_order");
    pub const PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR: [u8; 8] =
        make_anchor_discriminator(b"global:place_initial_offer_cctp_shim");
    pub const EXECUTE_ORDER_CCTP_SHIM_SELECTOR: [u8; 8] =
        make_anchor_discriminator(b"global:execute_order_cctp_shim");
    pub const PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR: [u8; 8] =
        make_anchor_discriminator(b"global:prepare_order_response_cctp_shim");
}
