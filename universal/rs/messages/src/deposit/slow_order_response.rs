//! Slow Order Response

use wormhole_io::{Readable, TypePrefixedPayload, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlowOrderResponse {
    pub base_fee: u64,
}

impl Readable for SlowOrderResponse {
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
    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.base_fee.write(writer)
    }
}

impl TypePrefixedPayload<1> for SlowOrderResponse {
    const TYPE: Option<[u8; 1]> = Some([2]);

    fn written_size(&self) -> usize {
        8
    }
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

        let message = raw::LiquidityLayerDepositMessage::parse(&encoded).unwrap();
        let parsed = message.to_slow_order_response_unchecked();

        let expected = SlowOrderResponse {
            base_fee: parsed.base_fee(),
        };

        assert_eq!(slow_order_response, expected);
    }
}
