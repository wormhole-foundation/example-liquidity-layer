//! The auction history state does not follow the same pattern as the other account schemas. Because
//! we do not lean on [AccountSerialize] and [AccountDeserialize] in account contexts for the full
//! auction history, we will be using a header to perform these operations to validate just the
//! beginning of each of these accounts. The history itself will be read in using [UncheckedAccount].

use std::ops::{Deref, DerefMut};

use anchor_lang::prelude::*;

use super::AuctionInfo;

#[account]
#[derive(Debug, Default)]
pub struct AuctionHistory {
    pub header: AuctionHistoryHeader,
    pub data: Vec<AuctionEntry>,
}

impl Deref for AuctionHistory {
    type Target = AuctionHistoryHeader;

    fn deref(&self) -> &Self::Target {
        &self.header
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct AuctionEntry {
    pub vaa_hash: [u8; 32],
    pub vaa_timestamp: u32,
    pub info: AuctionInfo,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Default)]
pub struct AuctionHistoryHeader {
    pub id: u64,
    pub min_timestamp: Option<u32>,
    pub max_timestamp: Option<u32>,
}

impl AuctionHistoryHeader {
    pub fn new(id: u64) -> Self {
        Self {
            id,
            min_timestamp: Default::default(),
            max_timestamp: Default::default(),
        }
    }
}

impl AuctionHistory {
    pub const SEED_PREFIX: &'static [u8] = b"auction-history";

    pub const START: usize = 8 + AuctionHistoryHeader::INIT_SPACE + 4;

    cfg_if::cfg_if! {
        if #[cfg(feature = "integration-test")] {
            pub const MAX_ENTRIES: u32 = 2;
        } else {
            #[allow(clippy::cast_possible_truncation)]
            pub const MAX_ENTRIES: u32 = ((10 * 1024 * 1000 - Self::START) / AuctionEntry::INIT_SPACE) as u32;
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuctionHistoryInternal {
    pub header: AuctionHistoryHeader,
    pub num_entries: u32,
}

impl AccountDeserialize for AuctionHistoryInternal {
    fn try_deserialize(buf: &mut &[u8]) -> Result<Self> {
        if buf[..8] != <AuctionHistory as anchor_lang::Discriminator>::DISCRIMINATOR {
            err!(ErrorCode::AccountDiscriminatorMismatch)
        } else {
            Self::try_deserialize_unchecked(buf)
        }
    }

    fn try_deserialize_unchecked(buf: &mut &[u8]) -> Result<Self> {
        *buf = &mut &buf[8..];
        Ok(Self {
            header: AnchorDeserialize::deserialize(buf)?,
            num_entries: AnchorDeserialize::deserialize(buf)?,
        })
    }
}

impl AccountSerialize for AuctionHistoryInternal {
    fn try_serialize<W: std::io::prelude::Write>(&self, writer: &mut W) -> Result<()> {
        <AuctionHistory as anchor_lang::Discriminator>::DISCRIMINATOR.serialize(writer)?;
        self.header.serialize(writer)?;
        self.num_entries.serialize(writer)?;
        Ok(())
    }
}

impl Owner for AuctionHistoryInternal {
    fn owner() -> Pubkey {
        crate::id()
    }
}

impl Deref for AuctionHistoryInternal {
    type Target = AuctionHistoryHeader;

    fn deref(&self) -> &Self::Target {
        &self.header
    }
}

impl DerefMut for AuctionHistoryInternal {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.header
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn check_max_entries() {
        const MAX: usize = (10 * 1024 * 1000 - AuctionHistory::START) / AuctionEntry::INIT_SPACE;
        assert!(MAX <= u32::MAX.try_into().unwrap());
    }
}
