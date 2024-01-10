//! Slow Order Response

use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlowOrderResponse {
    pub base_fee: u128,
}

impl Readable for SlowOrderResponse {
    const SIZE: Option<usize> = Some(16);

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            base_fee: Readable::read(reader)?,
        })
    }
}

impl Writeable for SlowOrderResponse {
    fn written_size(&self) -> usize {
        <Self as Readable>::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.base_fee.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload for SlowOrderResponse {
    const TYPE: Option<u8> = Some(14);
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
