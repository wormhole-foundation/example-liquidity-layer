//! Fast Fill

use crate::messages::Fill;
use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastFill {
    pub amount: u64,
    pub fill: Fill,
}

impl Readable for FastFill {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            fill: Readable::read(reader)?,
            amount: Readable::read(reader)?,
        })
    }
}

impl Writeable for FastFill {
    fn written_size(&self) -> usize {
        8 + self.fill.written_size()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.amount.write(writer)?;
        self.fill.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload for FastFill {
    const TYPE: Option<u8> = Some(12);
}

#[cfg(test)]
mod test {
    use hex_literal::hex;
    use messages::raw;

    use crate::messages;

    use super::*;

    #[test]
    fn serde() {
        let fast_fill = FastFill {
            amount: 1234567890,
            fill: Fill {
                source_chain: 69,
                order_sender: hex!(
                    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
                ),
                redeemer: hex!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                redeemer_message: b"All your base are belong to us.".to_vec().into(),
            },
        };

        let encoded = fast_fill.to_vec_payload();

        let msg = raw::LiquidityLayerMessage::parse(&encoded).unwrap();
        let parsed = msg.to_fast_fill_unchecked();

        let expected = FastFill {
            amount: parsed.amount(),
            fill: Fill {
                source_chain: parsed.fill().source_chain(),
                order_sender: parsed.fill().order_sender(),
                redeemer: parsed.fill().redeemer(),
                redeemer_message: parsed.fill().redeemer_message().as_ref().to_vec().into(),
            },
        };

        assert_eq!(fast_fill, expected);
    }
}
