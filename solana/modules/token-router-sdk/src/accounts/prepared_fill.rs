use std::ops::Deref;

use anchor_lang::{prelude::*, Discriminator};
use token_router::state::PreparedFillInfo;
use wormhole_io::{Readable, TypePrefixedPayload};

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PreparedFill<P: TypePrefixedPayload> {
    pub info: PreparedFillInfo,
    pub message_size: u32,
    pub redeemer_message: P,
}

impl<P: TypePrefixedPayload> Owner for PreparedFill<P> {
    fn owner() -> Pubkey {
        token_router::ID
    }
}

impl<P: TypePrefixedPayload> Discriminator for PreparedFill<P> {
    const DISCRIMINATOR: [u8; 8] = token_router::state::PreparedFill::DISCRIMINATOR;
}

impl<P: TypePrefixedPayload> AccountSerialize for PreparedFill<P> {
    fn try_serialize<W: std::io::prelude::Write>(&self, writer: &mut W) -> Result<()> {
        Self::DISCRIMINATOR.serialize(writer)?;
        self.info.serialize(writer)?;
        self.message_size.serialize(writer)?;
        self.redeemer_message.write(writer)?;
        Ok(())
    }
}

impl<P: TypePrefixedPayload> AccountDeserialize for PreparedFill<P> {
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

impl<P: TypePrefixedPayload> Deref for PreparedFill<P> {
    type Target = PreparedFillInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
