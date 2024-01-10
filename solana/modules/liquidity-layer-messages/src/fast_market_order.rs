//! Fast Market Order

use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

use crate::RedeemerMessage;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastMarketOrder {
    pub amount_in: u128,
    pub min_amount_out: u128,
    pub target_chain: u16,
    pub destination_cctp_domain: u32,
    pub redeemer: [u8; 32],
    pub sender: [u8; 32],
    pub refund_address: [u8; 32],
    pub slow_sequence: u64,
    pub slow_emitter: [u8; 32],
    pub max_fee: u128,
    pub init_auction_fee: u128,
    pub deadline: u32,
    pub redeemer_message: RedeemerMessage,
}

impl Readable for FastMarketOrder {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            amount_in: Readable::read(reader)?,
            min_amount_out: Readable::read(reader)?,
            target_chain: Readable::read(reader)?,
            destination_cctp_domain: Readable::read(reader)?,
            redeemer: Readable::read(reader)?,
            sender: Readable::read(reader)?,
            refund_address: Readable::read(reader)?,
            slow_sequence: Readable::read(reader)?,
            slow_emitter: Readable::read(reader)?,
            max_fee: Readable::read(reader)?,
            init_auction_fee: Readable::read(reader)?,
            deadline: Readable::read(reader)?,
            redeemer_message: Readable::read(reader)?,
        })
    }
}

impl Writeable for FastMarketOrder {
    fn written_size(&self) -> usize {
        16 + 16 + 2 + 4 + 32 + 32 + 32 + 8 + 32 + 16 + 16 + 4 + self.redeemer_message.written_size()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.amount_in.write(writer)?;
        self.min_amount_out.write(writer)?;
        self.target_chain.write(writer)?;
        self.destination_cctp_domain.write(writer)?;
        self.redeemer.write(writer)?;
        self.sender.write(writer)?;
        self.refund_address.write(writer)?;
        self.slow_sequence.write(writer)?;
        self.slow_emitter.write(writer)?;
        self.max_fee.write(writer)?;
        self.init_auction_fee.write(writer)?;
        self.deadline.write(writer)?;
        self.redeemer_message.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload for FastMarketOrder {
    const TYPE: Option<u8> = Some(13);
}

#[cfg(test)]
mod test {
    // use hex_literal::hex;

    // use super::*;

    // #[test]
    // fn transfer_tokens_with_relay() {
    //     let msg = TransferTokensWithRelay {
    //         target_relayer_fee: U256::from(69u64),
    //         to_native_token_amount: U256::from(420u64),
    //         target_recipient_wallet: hex!(
    //             "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    //         ),
    //     };

    //     let mut bytes = Vec::with_capacity(msg.payload_written_size());
    //     msg.write_typed(&mut bytes).unwrap();
    //     assert_eq!(bytes.len(), msg.payload_written_size());
    //     assert_eq!(bytes, hex!("01000000000000000000000000000000000000000000000000000000000000004500000000000000000000000000000000000000000000000000000000000001a4deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"));

    //     let mut cursor = std::io::Cursor::new(&mut bytes);
    //     let recovered = TransferTokensWithRelay::read_payload(&mut cursor).unwrap();
    //     assert_eq!(recovered, msg);
    // }

    // #[test]
    // fn invalid_message_type() {
    //     let mut bytes = hex!("45000000000000000000000000000000000000000000000000000000000000004500000000000000000000000000000000000000000000000000000000000001a4deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

    //     let mut cursor = std::io::Cursor::new(&mut bytes);
    //     let err = TransferTokensWithRelay::read_typed(&mut cursor)
    //         .err()
    //         .unwrap();
    //     matches!(err.kind(), std::io::ErrorKind::InvalidData);
    // }
}
