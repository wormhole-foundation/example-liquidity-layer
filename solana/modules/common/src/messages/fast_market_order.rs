//! Fast Market Order

use wormhole_io::{Readable, TypePrefixedPayload, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastMarketOrder {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub target_chain: u16,
    pub destination_cctp_domain: u32,
    pub redeemer: [u8; 32],
    pub sender: [u8; 32],
    pub refund_address: [u8; 32],
    pub max_fee: u64,
    pub init_auction_fee: u64,
    pub deadline: u32,
    pub redeemer_message: WriteableBytes,
}

impl Readable for FastMarketOrder {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        Ok(Self {
            amount_in: Readable::read(reader)?,
            min_amount_out: Readable::read(reader)?,
            target_chain: Readable::read(reader)?,
            destination_cctp_domain: Readable::read(reader)?,
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
    fn written_size(&self) -> usize {
        8 + 8 + 2 + 4 + 32 + 32 + 32 + 8 + 8 + 4 + self.redeemer_message.written_size()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        self.amount_in.write(writer)?;
        self.min_amount_out.write(writer)?;
        self.target_chain.write(writer)?;
        self.destination_cctp_domain.write(writer)?;
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

impl TypePrefixedPayload for FastMarketOrder {
    const TYPE: Option<u8> = Some(11);
}
