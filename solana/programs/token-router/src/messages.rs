//! Messages relevant to the Token Router across all networks. These messages are serialized and
//! then published via the Wormhole CCTP program.

use ruint::aliases::U256;
use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferTokensWithRelay {
    pub target_relayer_fee: U256,
    pub to_native_token_amount: U256,
    pub target_recipient_wallet: [u8; 32],
}

impl Readable for TransferTokensWithRelay {
    const SIZE: Option<usize> = Some(32 + 32 + 32);

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            target_relayer_fee: <[u8; 32]>::read(reader).map(U256::from_be_bytes)?,
            to_native_token_amount: <[u8; 32]>::read(reader).map(U256::from_be_bytes)?,
            target_recipient_wallet: Readable::read(reader)?,
        })
    }
}

impl Writeable for TransferTokensWithRelay {
    fn written_size(&self) -> usize {
        <Self as Readable>::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.target_relayer_fee.to_be_bytes::<32>().write(writer)?;
        self.to_native_token_amount
            .to_be_bytes::<32>()
            .write(writer)?;
        self.target_recipient_wallet.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload for TransferTokensWithRelay {
    const TYPE: Option<u8> = Some(1);
}

#[cfg(test)]
mod test {
    use hex_literal::hex;

    use super::*;

    #[test]
    fn transfer_tokens_with_relay() {
        let msg = TransferTokensWithRelay {
            target_relayer_fee: U256::from(69u64),
            to_native_token_amount: U256::from(420u64),
            target_recipient_wallet: hex!(
                "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            ),
        };

        let mut bytes = Vec::with_capacity(msg.payload_written_size());
        msg.write_typed(&mut bytes).unwrap();
        assert_eq!(bytes.len(), msg.payload_written_size());
        assert_eq!(bytes, hex!("01000000000000000000000000000000000000000000000000000000000000004500000000000000000000000000000000000000000000000000000000000001a4deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"));

        let mut cursor = std::io::Cursor::new(&mut bytes);
        let recovered = TransferTokensWithRelay::read_payload(&mut cursor).unwrap();
        assert_eq!(recovered, msg);
    }

    #[test]
    fn invalid_message_type() {
        let mut bytes = hex!("45000000000000000000000000000000000000000000000000000000000000004500000000000000000000000000000000000000000000000000000000000001a4deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");

        let mut cursor = std::io::Cursor::new(&mut bytes);
        let err = TransferTokensWithRelay::read_typed(&mut cursor)
            .err()
            .unwrap();
        matches!(err.kind(), std::io::ErrorKind::InvalidData);
    }
}
