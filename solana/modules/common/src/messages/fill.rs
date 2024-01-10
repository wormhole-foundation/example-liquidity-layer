//! Fill

use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fill {
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer: [u8; 32],
    pub redeemer_message: super::RedeemerMessage,
}

impl Readable for Fill {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            source_chain: Readable::read(reader)?,
            order_sender: Readable::read(reader)?,
            redeemer: Readable::read(reader)?,
            redeemer_message: Readable::read(reader)?,
        })
    }
}

impl Writeable for Fill {
    fn written_size(&self) -> usize {
        2 + 32 + 32 + self.redeemer_message.written_size()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.source_chain.write(writer)?;
        self.order_sender.write(writer)?;
        self.redeemer.write(writer)?;
        self.redeemer_message.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload for Fill {
    const TYPE: Option<u8> = Some(11);
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
