use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::cpi::ReceiveMessageArgs;
use common::wormhole_cctp_solana::messages::Deposit;
use common::wormhole_io::TypePrefixedPayload;
use solana_program::keccak;

use super::FastMarketOrder;

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct PrepareOrderResponseCctpShimData {
    pub encoded_cctp_message: Vec<u8>,
    pub cctp_attestation: Vec<u8>,
    pub finalized_vaa_message_args: FinalizedVaaMessageArgs,
}

#[derive(borsh::BorshDeserialize, borsh::BorshSerialize)]
pub struct FinalizedVaaMessageArgs {
    pub base_fee: u64, // Can also get from deposit payload
    pub consistency_level: u8,
    pub guardian_set_bump: u8,
}

impl FinalizedVaaMessageArgs {
    pub fn digest(
        &self,
        vaa_message_body_header: VaaMessageBodyHeader,
        deposit_vaa_payload: Deposit,
    ) -> [u8; 32] {
        let message_hash = keccak::hashv(&[
            vaa_message_body_header.vaa_time.to_be_bytes().as_ref(),
            vaa_message_body_header.nonce.to_be_bytes().as_ref(),
            vaa_message_body_header.emitter_chain.to_be_bytes().as_ref(),
            &vaa_message_body_header.emitter_address,
            &vaa_message_body_header.sequence.to_be_bytes(),
            &[vaa_message_body_header.consistency_level],
            deposit_vaa_payload.to_vec().as_ref(),
        ]);
        // Digest is the hash of the message
        keccak::hashv(&[message_hash.as_ref()])
            .as_ref()
            .try_into()
            .unwrap()
    }
}

impl PrepareOrderResponseCctpShimData {
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        Self::try_from_slice(data).ok()
    }

    pub fn to_receive_message_args(&self) -> ReceiveMessageArgs {
        let mut encoded_message = Vec::with_capacity(self.encoded_cctp_message.len());
        encoded_message.extend_from_slice(&self.encoded_cctp_message);
        let mut cctp_attestation = Vec::with_capacity(self.cctp_attestation.len());
        cctp_attestation.extend_from_slice(&self.cctp_attestation);
        ReceiveMessageArgs {
            encoded_message,
            attestation: cctp_attestation,
        }
    }
}

/// VaaMessageBodyHeader for the digest calculation
///
/// This is the header of the vaa message body. It is used to calculate the digest of the fast market order.
#[derive(Debug)]
pub struct VaaMessageBodyHeader {
    pub consistency_level: u8,
    pub vaa_time: u32,
    pub nonce: u32,
    pub sequence: u64,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
}

impl VaaMessageBodyHeader {
    pub fn new(
        consistency_level: u8,
        vaa_time: u32,
        sequence: u64,
        emitter_chain: u16,
        emitter_address: [u8; 32],
    ) -> Self {
        Self {
            consistency_level,
            vaa_time,
            nonce: 0,
            sequence,
            emitter_chain,
            emitter_address,
        }
    }

    /// This function creates both the message body for the fast market order, including the payload.
    pub fn message_body(&self, fast_market_order: &FastMarketOrder) -> Vec<u8> {
        let mut message_body = vec![];
        message_body.extend_from_slice(&self.vaa_time.to_be_bytes());
        message_body.extend_from_slice(&self.nonce.to_be_bytes());
        message_body.extend_from_slice(&self.emitter_chain.to_be_bytes());
        message_body.extend_from_slice(&self.emitter_address);
        message_body.extend_from_slice(&self.sequence.to_be_bytes());
        message_body.extend_from_slice(&[self.consistency_level]);
        message_body.push(11_u8);
        message_body.extend_from_slice(&fast_market_order.amount_in.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.min_amount_out.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.target_chain.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.redeemer);
        message_body.extend_from_slice(&fast_market_order.sender);
        message_body.extend_from_slice(&fast_market_order.refund_address);
        message_body.extend_from_slice(&fast_market_order.max_fee.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.init_auction_fee.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.deadline.to_be_bytes());
        message_body.extend_from_slice(&fast_market_order.redeemer_message_length.to_be_bytes());
        if fast_market_order.redeemer_message_length > 0 {
            message_body.extend_from_slice(
                &fast_market_order.redeemer_message
                    [..usize::from(fast_market_order.redeemer_message_length)],
            );
        }
        message_body
    }

    /// This function creates the hash of the message body for the fast market order.
    /// This is used to create the digest.
    pub fn message_hash(&self, fast_market_order: &FastMarketOrder) -> keccak::Hash {
        keccak::hashv(&[self.message_body(fast_market_order).as_ref()])
    }

    /// The digest is the hash of the message hash.
    pub fn digest(&self, fast_market_order: &FastMarketOrder) -> keccak::Hash {
        keccak::hashv(&[self.message_hash(fast_market_order).as_ref()])
    }

    /// This function returns the vaa time.
    pub fn vaa_time(&self) -> u32 {
        self.vaa_time
    }

    /// This function returns the sequence number of the fast market order.
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// This function returns the emitter chain of the fast market order.
    pub fn emitter_chain(&self) -> u16 {
        self.emitter_chain
    }
}
