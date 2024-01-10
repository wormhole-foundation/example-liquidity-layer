use wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedeemerMessage(Vec<u8>);

impl From<RedeemerMessage> for Vec<u8> {
    fn from(v: RedeemerMessage) -> Vec<u8> {
        v.0
    }
}

impl Readable for RedeemerMessage {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> std::io::Result<Self>
    where
        Self: Sized,
        R: std::io::Read,
    {
        let msg_len = u32::read(reader)?;
        let mut out = Vec::with_capacity(msg_len as usize);
        reader.read_to_end(&mut out)?;
        Ok(Self(out))
    }
}

impl Writeable for RedeemerMessage {
    fn written_size(&self) -> usize {
        4 + self.0.len()
    }

    fn write<W>(&self, writer: &mut W) -> std::io::Result<()>
    where
        Self: Sized,
        W: std::io::Write,
    {
        // usize -> u32 is infallible here.
        (self.0.len() as u32).write(writer)?;
        writer.write_all(&self.0)?;
        Ok(())
    }
}
