//! Fill

use wormhole_io::{Readable, TypePrefixedPayload, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fill {
    pub source_chain: u16,
    pub order_sender: [u8; 32],
    pub redeemer: [u8; 32],
    pub redeemer_message: WriteableBytes,
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
        const ADDITIONAL: usize = 2 + 32 + 32;
        self.redeemer_message
            .written_size()
            .saturating_add(ADDITIONAL)
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
    const TYPE: Option<u8> = Some(1);
}

#[cfg(test)]
mod test {
    use hex_literal::hex;
    use wormhole_io::Writeable;

    use crate::messages;

    #[test]
    fn serde() {
        let fill = messages::Fill {
            source_chain: 69,
            order_sender: hex!("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
            redeemer: hex!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            redeemer_message: b"All your base are belong to us.".to_vec().into(),
        };

        let encoded = fill.to_vec();

        let parsed = messages::raw::Fill::parse(&encoded).unwrap();

        let expected = messages::Fill {
            source_chain: parsed.source_chain(),
            order_sender: parsed.order_sender(),
            redeemer: parsed.redeemer(),
            redeemer_message: parsed.redeemer_message().as_ref().to_vec().into(),
        };

        assert_eq!(fill, expected);
    }
}
