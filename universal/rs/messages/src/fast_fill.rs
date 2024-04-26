//! Fast Fill

use crate::Fill;
use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastFill {
    pub amount: u64,
    pub fill: Fill,
}

impl Readable for FastFill {
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

impl TypePrefixedPayload<1> for FastFill {
    const TYPE: Option<[u8; 1]> = Some([12]);

    fn written_size(&self) -> usize {
        // This will panic if the size is too large to fit in a usize. But better to panic than to
        // saturate to usize::MAX.
        self.fill.written_size().checked_add(8).unwrap()
    }
}

#[cfg(test)]
mod test {
    use crate::raw;
    use hex_literal::hex;

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
                redeemer_message: b"All your base are belong to us."
                    .to_vec()
                    .try_into()
                    .unwrap(),
            },
        };

        let encoded = fast_fill.to_vec();

        let msg = raw::LiquidityLayerMessage::parse(&encoded).unwrap();
        let parsed = msg.to_fast_fill_unchecked();

        let expected = FastFill {
            amount: parsed.amount(),
            fill: Fill {
                source_chain: parsed.fill().source_chain(),
                order_sender: parsed.fill().order_sender(),
                redeemer: parsed.fill().redeemer(),
                redeemer_message: parsed
                    .fill()
                    .redeemer_message()
                    .as_ref()
                    .to_vec()
                    .try_into()
                    .unwrap(),
            },
        };

        assert_eq!(fast_fill, expected);
    }
}
