
use crate::ID;
use anchor_lang::prelude::*;
use wormhole_svm_definitions::make_anchor_discriminator;
use super::place_initial_offer::PlaceInitialOfferCctpShimData;
use super::place_initial_offer::place_initial_offer_cctp_shim;
use super::execute_order::handle_execute_order_shim;
use super::initialise_fast_market_order::{initialise_fast_market_order, InitialiseFastMarketOrderData};
use super::close_fast_market_order::close_fast_market_order;
use super::prepare_order_response::prepare_order_response_cctp_shim;
use super::prepare_order_response::PrepareOrderResponseCctpShimData;



impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub const PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:place_initial_offer_cctp_shim");
    pub const EXECUTE_ORDER_CCTP_SHIM_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:execute_order_cctp_shim");
    pub const INITIALISE_FAST_MARKET_ORDER_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:initialise_fast_market_order");
    pub const CLOSE_FAST_MARKET_ORDER_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:close_fast_market_order");
    pub const PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:prepare_order_response_cctp_shim");
}

pub enum FallbackMatchingEngineInstruction<'ix> {
    PlaceInitialOfferCctpShim(&'ix PlaceInitialOfferCctpShimData),
    ExecuteOrderCctpShim,
    InitialiseFastMarketOrder(&'ix InitialiseFastMarketOrderData),
    CloseFastMarketOrder,
    PrepareOrderResponseCctpShim(PrepareOrderResponseCctpShimData),
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> Result<()> {
    if program_id != &ID {
        return Err(ErrorCode::InvalidProgramId.into());
    }

    let instruction = FallbackMatchingEngineInstruction::deserialize(instruction_data).unwrap();
    match instruction {
        FallbackMatchingEngineInstruction::PlaceInitialOfferCctpShim(data) => {
            place_initial_offer_cctp_shim(accounts, &data)
        },
        FallbackMatchingEngineInstruction::ExecuteOrderCctpShim => {
            handle_execute_order_shim(accounts)
        },
        FallbackMatchingEngineInstruction::InitialiseFastMarketOrder(data) => {
            initialise_fast_market_order(accounts, &data)
        },
        FallbackMatchingEngineInstruction::CloseFastMarketOrder => {
            close_fast_market_order(accounts)
        }
        FallbackMatchingEngineInstruction::PrepareOrderResponseCctpShim(data) => {
            prepare_order_response_cctp_shim(accounts, data)
        }
    }
}

impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub fn deserialize(instruction_data: &'ix [u8]) -> Option<Self> {
        if instruction_data.len() < 8 {
            return None;
        }

        match instruction_data[..8].try_into().unwrap() {
            FallbackMatchingEngineInstruction::PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR => {
                Some(Self::PlaceInitialOfferCctpShim(&PlaceInitialOfferCctpShimData::from_bytes(&instruction_data[8..]).unwrap()))
            },
            FallbackMatchingEngineInstruction::EXECUTE_ORDER_CCTP_SHIM_SELECTOR => {
                Some(Self::ExecuteOrderCctpShim)
            },
            FallbackMatchingEngineInstruction::INITIALISE_FAST_MARKET_ORDER_SELECTOR => {
                Some(Self::InitialiseFastMarketOrder(&bytemuck::from_bytes(&instruction_data[8..])))
            },
            _ => None,
        }
    }
}

impl FallbackMatchingEngineInstruction<'_> {
    pub fn to_vec(&self) -> Vec<u8> {
        match self {
            Self::PlaceInitialOfferCctpShim(data) => {
                // Calculate the total capacity needed
                let data_slice = bytemuck::bytes_of(*data);
                let total_capacity = 8 + data_slice.len(); // 8 for the selector, plus the data length

                // Create a vector with the calculated capacity
                let mut out = Vec::with_capacity(total_capacity);

                // Add the selector
                out.extend_from_slice(&FallbackMatchingEngineInstruction::PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR);

                // Extend the vector with the data slice
                out.extend_from_slice(data_slice);

                out
            },
            Self::ExecuteOrderCctpShim => {
                let total_capacity = 8; // 8 for the selector (no data)

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(&FallbackMatchingEngineInstruction::EXECUTE_ORDER_CCTP_SHIM_SELECTOR);
                

                out
            }
            Self::InitialiseFastMarketOrder(data) => {
                let data_slice = bytemuck::bytes_of(*data);
                let total_capacity = 8 + data_slice.len(); // 8 for the selector, plus the data length

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(&FallbackMatchingEngineInstruction::INITIALISE_FAST_MARKET_ORDER_SELECTOR);
                out.extend_from_slice(data_slice);

                out
            },
            Self::CloseFastMarketOrder => {
                let total_capacity = 8; // 8 for the selector (no data)

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(&FallbackMatchingEngineInstruction::CLOSE_FAST_MARKET_ORDER_SELECTOR);

                out
            },

            Self::PrepareOrderResponseCctpShim(data) => {
                let data_slice = data.to_bytes();
                let total_capacity = 8 + data_slice.len(); // 8 for the selector, plus the data length

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(&FallbackMatchingEngineInstruction::PREPARE_ORDER_RESPONSE_CCTP_SHIM_SELECTOR);
                out.extend_from_slice(&data_slice);

                out
            }
        }
    }
}