//! Fill

use wormhole_io::{Readable, TypePrefixedPayload, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fill {
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer: [u8; 32],
    pub redeemer_message: WriteableBytes<u32>,
}

impl Readable for Fill {
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

impl TypePrefixedPayload<1> for Fill {
    const TYPE: Option<[u8; 1]> = Some([1]);

    fn written_size(&self) -> usize {
        const FIXED: usize = 2 // source_chain
            + 32 // order_sender
            + 32 // redeemer
            + 4 // redeemer_message length
            ;
        self.redeemer_message.len().checked_add(FIXED).unwrap()
    }
}

#[cfg(test)]
mod test {
    use crate::raw;
    use hex_literal::hex;

    use super::*;

    #[test]
    fn serde() {
        let fill = Fill {
            source_chain: 69,
            order_sender: hex!("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
            redeemer: hex!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            redeemer_message: b"All your base are belong to us."
                .to_vec()
                .try_into()
                .unwrap(),
        };

        let encoded = fill.to_vec();

        let message = raw::LiquidityLayerDepositMessage::parse(&encoded).unwrap();
        let parsed = message.to_fill_unchecked();

        let expected = Fill {
            source_chain: parsed.source_chain(),
            order_sender: parsed.order_sender(),
            redeemer: parsed.redeemer(),
            redeemer_message: parsed
                .redeemer_message()
                .as_ref()
                .to_vec()
                .try_into()
                .unwrap(),
        };

        assert_eq!(fill, expected);
    }
}
