//! The auction history state does not follow the same pattern as the other account schemas. Because
//! we do not lean on [AccountSerialize] and [AccountDeserialize] in account contexts for the full
//! auction history, we will be using a header to perform these operations to validate just the
//! beginning of each of these accounts. The history itself will be read in using [AccountInfo].

use std::ops::Deref;

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
    pub info: AuctionInfo,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Default)]
pub struct AuctionHistoryHeader {
    pub id: u64,
    pub min_timestamp: u32,
    pub max_timestamp: u32,
}

impl AuctionHistory {
    pub const SEED_PREFIX: &'static [u8] = b"auction-history";

    pub const START: usize = 8 + AuctionHistoryHeader::INIT_SPACE + 4;

    cfg_if::cfg_if! {
        if #[cfg(feature = "integration-test")] {
            pub const MAX_ENTRIES: usize = 2;
        } else {
            pub const MAX_ENTRIES: usize = (10 * 1024 * 1000 - Self::START) / AuctionEntry::INIT_SPACE;
        }
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuctionHistoryInternal(AuctionHistoryHeader, u32);

impl AuctionHistoryInternal {
    pub fn num_entries(&self) -> usize {
        usize::try_from(self.1).unwrap()
    }
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
        Ok(Self(
            AnchorDeserialize::deserialize(buf)?,
            AnchorDeserialize::deserialize(buf)?,
        ))
    }
}

impl AccountSerialize for AuctionHistoryInternal {}

impl Owner for AuctionHistoryInternal {
    fn owner() -> Pubkey {
        crate::id()
    }
}

impl Deref for AuctionHistoryInternal {
    type Target = AuctionHistoryHeader;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

// pub fn insert_auction_entry(
//     auction_history: &mut Account<AuctionHistory>,
//     payer: &Signer,
//     system_program: &Program<System>,
//     entry: AuctionEntry,
// ) -> Result<()> {
//     auction_history.header.num_entries += 1;

//     let n = auction_history.header.num_entries;
//     if n > MAX_ENTRIES as u32 {
//         return err!(ErrorCode::InstructionMissing);
//     }

//     {
//         let acc_info: &AccountInfo = auction_history.as_ref();

//         let new_len = usize::try_from(n)
//             .map(|n| START + n * AuctionEntry::INIT_SPACE)
//             .unwrap();
//         let lamport_diff =
//             Rent::get().unwrap().minimum_balance(new_len) - acc_info.try_lamports()?;

//         // Transfer lamports
//         system_program::transfer(
//             CpiContext::new(
//                 system_program.to_account_info(),
//                 system_program::Transfer {
//                     from: payer.to_account_info(),
//                     to: acc_info.to_account_info(),
//                 },
//             ),
//             lamport_diff,
//         )?;

//         // Realloc.
//         acc_info.realloc(new_len, false)?;
//     }

//     let mut data: &mut [_] = &mut acc_info.try_borrow_mut_data()?;

//     let i = usize::try_from(auction_history.header.num_entries)
//         .map(|i| i + AuctionEntry::INIT_SPACE + START)
//         .unwrap();
//     data = &mut data[i..(i + AuctionEntry::INIT_SPACE)];
//     entry.serialize(&mut data)?;

//     auction_history.header.num_entries += 1;
//     Ok(())
// }
