use std::ops::Deref;

use anchor_lang::{prelude::*, Discriminator};
use token_router::state::PreparedFillInfo;
use wormhole_io::{Readable, TypePrefixedPayload};

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PreparedFill<const N: usize, P>
where
    P: TypePrefixedPayload<N>,
{
    pub info: PreparedFillInfo,
    pub message_size: u32,
    pub redeemer_message: P,
}

impl<const N: usize, P> Owner for PreparedFill<N, P>
where
    P: TypePrefixedPayload<N>,
{
    fn owner() -> Pubkey {
        token_router::ID
    }
}

impl<const N: usize, P> Discriminator for PreparedFill<N, P>
where
    P: TypePrefixedPayload<N>,
{
    const DISCRIMINATOR: [u8; 8] = token_router::state::PreparedFill::DISCRIMINATOR;
}

impl<const N: usize, P> AccountSerialize for PreparedFill<N, P>
where
    P: TypePrefixedPayload<N>,
{
    fn try_serialize<W: std::io::prelude::Write>(&self, writer: &mut W) -> Result<()> {
        Self::DISCRIMINATOR.serialize(writer)?;
        self.info.serialize(writer)?;
        self.message_size.serialize(writer)?;
        self.redeemer_message.write(writer)?;
        Ok(())
    }
}

impl<const N: usize, P> AccountDeserialize for PreparedFill<N, P>
where
    P: TypePrefixedPayload<N>,
{
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        let disc_len = Self::DISCRIMINATOR.len();
        if buf.len() < disc_len {
            return err!(ErrorCode::AccountDidNotDeserialize);
        };
        if Self::DISCRIMINATOR != buf[..disc_len] {
            return err!(ErrorCode::AccountDidNotDeserialize);
        }
        Self::try_deserialize_unchecked(buf)
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        let mut data = &buf[Self::DISCRIMINATOR.len()..];
        Ok(Self {
            info: AnchorDeserialize::deserialize(&mut data)?,
            message_size: AnchorDeserialize::deserialize(&mut data)?,
            redeemer_message: Readable::read(&mut data)?,
        })
    }
}

impl<const N: usize, P> Deref for PreparedFill<N, P>
where
    P: TypePrefixedPayload<N>,
{
    type Target = PreparedFillInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
