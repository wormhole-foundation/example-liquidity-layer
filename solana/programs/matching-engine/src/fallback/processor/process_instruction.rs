use anchor_lang::prelude::*;
use wormhole_svm_definitions::make_anchor_discriminator;

use crate::ID;

use super::close_fast_market_order::close_fast_market_order;
use super::execute_order::handle_execute_order_shim;
use super::initialize_fast_market_order::{self, InitializeFastMarketOrderData};
use super::place_initial_offer::{place_initial_offer_cctp_shim, PlaceInitialOfferCctpShimData};
use super::prepare_order_response::{
    prepare_order_response_cctp_shim, PrepareOrderResponseCctpShimData,
};

const SELECTOR_SIZE: usize = 8;

impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub const INITIALIZE_FAST_MARKET_ORDER_SELECTOR: [u8; SELECTOR_SIZE] =
        make_anchor_discriminator(b"global:initialize_fast_market_order");
    pub const CLOSE_FAST_MARKET_ORDER_SELECTOR: [u8; SELECTOR_SIZE] =
        make_anchor_discriminator(b"global:close_fast_market_order");
    pub const PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR: [u8; SELECTOR_SIZE] =
        make_anchor_discriminator(b"global:place_initial_offer_cctp_shim");
    pub const EXECUTE_ORDER_CCTP_SHIM_SELECTOR: [u8; SELECTOR_SIZE] =
        make_anchor_discriminator(b"global:execute_order_cctp_shim");
    pub const PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR: [u8; SELECTOR_SIZE] =
        make_anchor_discriminator(b"global:prepare_order_response_cctp_shim");
}

pub enum FallbackMatchingEngineInstruction<'ix> {
    InitializeFastMarketOrder(&'ix InitializeFastMarketOrderData),
    CloseFastMarketOrder,
    PlaceInitialOfferCctpShim(&'ix PlaceInitialOfferCctpShimData),
    ExecuteOrderCctpShim,
    PrepareOrderResponseCctpShim(PrepareOrderResponseCctpShimData),
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<()> {
    if program_id != &ID {
        return Err(ErrorCode::InvalidProgramId.into());
    }

    let instruction = FallbackMatchingEngineInstruction::deserialize(instruction_data)
        .ok_or_else(|| ErrorCode::InstructionDidNotDeserialize)?;

    match instruction {
        FallbackMatchingEngineInstruction::InitializeFastMarketOrder(data) => {
            initialize_fast_market_order::process(accounts, data)
        }
        FallbackMatchingEngineInstruction::CloseFastMarketOrder => {
            close_fast_market_order(accounts)
        }
        FallbackMatchingEngineInstruction::PlaceInitialOfferCctpShim(data) => {
            place_initial_offer_cctp_shim(accounts, data)
        }
        FallbackMatchingEngineInstruction::ExecuteOrderCctpShim => {
            handle_execute_order_shim(accounts)
        }
        FallbackMatchingEngineInstruction::PrepareOrderResponseCctpShim(data) => {
            prepare_order_response_cctp_shim(accounts, data)
        }
    }
}

impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub fn deserialize(instruction_data: &'ix [u8]) -> Option<Self> {
        if instruction_data.len() < SELECTOR_SIZE {
            return None;
        }

        match instruction_data[..SELECTOR_SIZE].try_into().unwrap() {
            FallbackMatchingEngineInstruction::PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR => {
                Some(Self::PlaceInitialOfferCctpShim(
                    PlaceInitialOfferCctpShimData::from_bytes(&instruction_data[SELECTOR_SIZE..])
                        .unwrap(),
                ))
            }
            FallbackMatchingEngineInstruction::INITIALIZE_FAST_MARKET_ORDER_SELECTOR => {
                Some(Self::InitializeFastMarketOrder(bytemuck::from_bytes(
                    &instruction_data[SELECTOR_SIZE..],
                )))
            }
            FallbackMatchingEngineInstruction::CLOSE_FAST_MARKET_ORDER_SELECTOR => {
                Some(Self::CloseFastMarketOrder)
            }
            FallbackMatchingEngineInstruction::EXECUTE_ORDER_CCTP_SHIM_SELECTOR => {
                Some(Self::ExecuteOrderCctpShim)
            }
            FallbackMatchingEngineInstruction::PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR => {
                Some(Self::PrepareOrderResponseCctpShim(
                    PrepareOrderResponseCctpShimData::from_bytes(
                        &instruction_data[SELECTOR_SIZE..],
                    )
                    .unwrap(),
                ))
            }
            _ => None,
        }
    }
}

impl FallbackMatchingEngineInstruction<'_> {
    pub fn to_vec(&self) -> Vec<u8> {
        match self {
            Self::InitializeFastMarketOrder(data) => {
                let mut out = Vec::with_capacity(
                    std::mem::size_of::<InitializeFastMarketOrderData>().saturating_add(8),
                );

                out.extend_from_slice(
                    &FallbackMatchingEngineInstruction::INITIALIZE_FAST_MARKET_ORDER_SELECTOR,
                );
                out.extend_from_slice(bytemuck::bytes_of(*data));

                out
            }
            Self::PlaceInitialOfferCctpShim(data) => {
                // Calculate the total capacity needed
                let data_slice = bytemuck::bytes_of(*data);
                let total_capacity = 8_usize.saturating_add(data_slice.len()); // 8 for the selector, plus the data length

                // Create a vector with the calculated capacity
                let mut out = Vec::with_capacity(total_capacity);

                // Add the selector
                out.extend_from_slice(
                    &FallbackMatchingEngineInstruction::PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR,
                );
                out.extend_from_slice(data_slice);

                out
            }
            Self::ExecuteOrderCctpShim => {
                let total_capacity = 8; // 8 for the selector (no data)

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(
                    &FallbackMatchingEngineInstruction::EXECUTE_ORDER_CCTP_SHIM_SELECTOR,
                );

                out
            }
            Self::CloseFastMarketOrder => {
                let total_capacity = 8; // 8 for the selector (no data)

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(
                    &FallbackMatchingEngineInstruction::CLOSE_FAST_MARKET_ORDER_SELECTOR,
                );

                out
            }
            Self::PrepareOrderResponseCctpShim(data) => {
                let data_slice = data.try_to_vec().unwrap();
                let total_capacity = 8_usize.saturating_add(data_slice.len()); // 8 for the selector, plus the data length

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(
                    &FallbackMatchingEngineInstruction::PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR,
                );
                out.extend_from_slice(&data_slice);

                out
            }
        }
    }
}
