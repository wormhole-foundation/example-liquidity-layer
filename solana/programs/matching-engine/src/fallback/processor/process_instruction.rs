
use crate::ID;
use anchor_lang::prelude::*;
use wormhole_svm_definitions::make_anchor_discriminator;
use super::place_initial_offer::PlaceInitialOfferCctpShimData;
use super::place_initial_offer::place_initial_offer_cctp_shim;
use super::execute_order::ExecuteOrderCctpShimData;
use super::execute_order::handle_execute_order_shim;



impl<'ix> FallbackMatchingEngineInstruction<'ix> {
    pub const PLACE_INITIAL_OFFER_CCTP_SHIM_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:place_initial_offer_cctp_shim");
    pub const EXECUTE_ORDER_CCTP_SHIM_SELECTOR: [u8; 8] = make_anchor_discriminator(b"global:execute_order_cctp_shim");
}

pub enum FallbackMatchingEngineInstruction<'ix> {
    PlaceInitialOfferCctpShim(&'ix PlaceInitialOfferCctpShimData),
    ExecuteOrderCctpShim(&'ix ExecuteOrderCctpShimData),
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
        FallbackMatchingEngineInstruction::ExecuteOrderCctpShim(data) => {
            handle_execute_order_shim(accounts, &data)
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
                Some(Self::ExecuteOrderCctpShim(&ExecuteOrderCctpShimData::from_bytes(&instruction_data[8..]).unwrap()))
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
            Self::ExecuteOrderCctpShim(data) => {
                let data_slice = bytemuck::bytes_of(*data);
                let total_capacity = 8 + data_slice.len(); // 8 for the selector, plus the data length

                let mut out = Vec::with_capacity(total_capacity);

                out.extend_from_slice(&FallbackMatchingEngineInstruction::EXECUTE_ORDER_CCTP_SHIM_SELECTOR);
                out.extend_from_slice(data_slice);

                out
            }
        }
    }
}