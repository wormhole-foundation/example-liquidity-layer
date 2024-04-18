//! Slow Order Response

use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlowOrderResponse {
    pub base_fee: u64,
}

impl Readable for SlowOrderResponse {
    const SIZE: Option<usize> = Some(8);

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
    const TYPE: Option<u8> = Some(2);
}

#[cfg(test)]
mod test {
    use crate::raw;

    use super::*;

    #[test]
    fn serde() {
        let slow_order_response = SlowOrderResponse {
            base_fee: 1234567890,
        };

        let encoded = slow_order_response.to_vec();

        let parsed = raw::SlowOrderResponse::parse(&encoded).unwrap();

        let expected = SlowOrderResponse {
            base_fee: parsed.base_fee(),
        };

        assert_eq!(slow_order_response, expected);
    }
}
