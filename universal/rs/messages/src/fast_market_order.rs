//! Fast Market Order

use wormhole_io::{Readable, TypePrefixedPayload, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastMarketOrder {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub target_chain: u16,
    pub redeemer: [u8; 32],
    pub sender: [u8; 32],
    pub refund_address: [u8; 32],
    pub max_fee: u64,
    pub init_auction_fee: u64,
    pub deadline: u32,
    pub redeemer_message: WriteableBytes<u16>,
}

impl Readable for FastMarketOrder {
    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            amount_in: Readable::read(reader)?,
            min_amount_out: Readable::read(reader)?,
            target_chain: Readable::read(reader)?,
            redeemer: Readable::read(reader)?,
            sender: Readable::read(reader)?,
            refund_address: Readable::read(reader)?,
            max_fee: Readable::read(reader)?,
            init_auction_fee: Readable::read(reader)?,
            deadline: Readable::read(reader)?,
            redeemer_message: Readable::read(reader)?,
        })
    }
}

impl Writeable for FastMarketOrder {
    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.amount_in.write(writer)?;
        self.min_amount_out.write(writer)?;
        self.target_chain.write(writer)?;
        self.redeemer.write(writer)?;
        self.sender.write(writer)?;
        self.refund_address.write(writer)?;
        self.max_fee.write(writer)?;
        self.init_auction_fee.write(writer)?;
        self.deadline.write(writer)?;
        self.redeemer_message.write(writer)?;
        Ok(())
    }
}

impl TypePrefixedPayload<1> for FastMarketOrder {
    const TYPE: Option<[u8; 1]> = Some([11]);

    fn written_size(&self) -> usize {
        const FIXED: usize = 8 // amount_in
            + 8 // min_amount_out
            + 2 // target_chain
            + 32 // redeemer
            + 32 // sender
            + 32 // refund_address
            + 8 // max_fee
            + 8 // init_auction_fee
            + 4 // deadline
            + 2 // redeemer_message length
            ;
        // This will panic if the size is too large to fit in a usize. But better to panic than to
        // saturate to usize::MAX.
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
        let fast_market_order = FastMarketOrder {
            amount_in: 1234567890,
            min_amount_out: 69420,
            target_chain: 69,
            redeemer: hex!("deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
            sender: hex!("beefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead"),
            refund_address: hex!(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ),
            max_fee: 1234567890,
            init_auction_fee: 69420,
            deadline: 420,
            redeemer_message: b"All your base are belong to us."
                .to_vec()
                .try_into()
                .unwrap(),
        };

        let encoded = fast_market_order.to_vec();

        let msg = raw::LiquidityLayerMessage::parse(&encoded).unwrap();
        let parsed = msg.to_fast_market_order_unchecked();

        let expected = FastMarketOrder {
            amount_in: parsed.amount_in(),
            min_amount_out: parsed.min_amount_out(),
            target_chain: parsed.target_chain(),
            redeemer: parsed.redeemer(),
            sender: parsed.sender(),
            refund_address: parsed.refund_address(),
            max_fee: parsed.max_fee(),
            init_auction_fee: parsed.init_auction_fee(),
            deadline: parsed.deadline(),
            redeemer_message: parsed
                .redeemer_message()
                .as_ref()
                .to_vec()
                .try_into()
                .unwrap(),
        };

        assert_eq!(fast_market_order, expected);
    }
}
