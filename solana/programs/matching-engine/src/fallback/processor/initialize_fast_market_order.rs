use anchor_lang::{prelude::*, Discriminator};
use bytemuck::{Pod, Zeroable};
use solana_program::{instruction::Instruction, keccak};

use crate::{state::FastMarketOrder, ID};

const NUM_ACCOUNTS: usize = 6;

pub struct InitializeFastMarketOrderAccounts<'ix> {
    /// Lamports from this signer will be used to create the new fast market
    /// order account. This account will be the only authority allowed to
    /// close this account.
    // TODO: Rename to "payer".
    pub signer: &'ix Pubkey, // 0
    /// Wormhole guardian set account used to check recovered pubkeys using
    /// [Self::guardian_set_signatures].
    // TODO: Rename to "wormhole_guardian_set"
    pub verify_vaa_shim_program: &'ix Pubkey, // 1
    pub guardian_set: &'ix Pubkey, // 2
    /// The guardian set signatures of fast market order VAA.
    // TODO: Rename to "shim_guardian_signatures".
    pub guardian_set_signatures: &'ix Pubkey, // 3
    /// The fast market order account pubkey (that is created by the
    /// instruction).
    // TODO: Rename to "new_fast_market_order".
    pub fast_market_order_account: &'ix Pubkey, // 4
    // TODO: Remove.
    pub system_program: &'ix Pubkey, // 5
}

#[derive(Debug, Copy, Clone, Pod, Zeroable)]
#[repr(C)]
pub struct InitializeFastMarketOrderData {
    /// The fast market order as the bytemuck struct
    pub fast_market_order: FastMarketOrder,
    /// The guardian set bump
    pub guardian_set_bump: u8,
    /// Padding to ensure bytemuck deserialization works
    _padding: [u8; 7],
}

impl InitializeFastMarketOrderData {
    // Adds the padding to the InitializeFastMarketOrderData
    // TODO: change FastMarketOrder to FastMarketOrderParams.
    pub fn new(fast_market_order: FastMarketOrder, guardian_set_bump: u8) -> Self {
        Self {
            fast_market_order,
            guardian_set_bump,
            _padding: Default::default(),
        }
    }
}

/// Initializes the fast market order account.
///
/// The verify shim program first checks that the digest of the fast market
/// order is correct, and that the guardian signature is correct and
/// recoverable. If this is the case, the fast market order account is created.
/// The fast market order account is owned by the matching engine program. It
/// can be closed by the close fast market order instruction, which returns the
/// lamports to the close account refund recipient.
pub struct InitializeFastMarketOrder<'ix> {
    pub program_id: &'ix Pubkey,
    pub accounts: InitializeFastMarketOrderAccounts<'ix>,
    pub data: InitializeFastMarketOrderData,
}

impl InitializeFastMarketOrder<'_> {
    pub fn instruction(&self) -> Instruction {
        let InitializeFastMarketOrderAccounts {
            signer: payer,
            fast_market_order_account: new_fast_market_order,
            guardian_set: wormhole_guardian_set,
            guardian_set_signatures: shim_guardian_signatures,
            verify_vaa_shim_program,
            system_program: _,
        } = self.accounts;

        let accounts = vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(*verify_vaa_shim_program, false),
            AccountMeta::new_readonly(*wormhole_guardian_set, false),
            AccountMeta::new_readonly(*shim_guardian_signatures, false),
            AccountMeta::new(*new_fast_market_order, false),
            AccountMeta::new_readonly(solana_program::system_program::ID, false),
        ];
        debug_assert_eq!(accounts.len(), NUM_ACCOUNTS);

        Instruction {
            program_id: *self.program_id,
            accounts,
            data: super::FallbackMatchingEngineInstruction::InitializeFastMarketOrder(&self.data)
                .to_vec(),
        }
    }
}

pub(super) fn process(
    accounts: &[AccountInfo],
    data: &InitializeFastMarketOrderData,
) -> Result<()> {
    super::helpers::require_min_account_infos_len(accounts, NUM_ACCOUNTS)?;

    let fast_market_order = &data.fast_market_order;

    // Generate the VAA digest, which will be used to verify the guardian
    // signatures.
    let fast_market_order_vaa_digest = fast_market_order.digest();

    // This payer will send lamports to the new fast market order account and
    // will be the "owner" of this account. Only this account can close the
    // fast market order account.
    let payer_info = &accounts[0];

    // Verify the VAA digest with the Verify VAA shim program.
    super::helpers::invoke_verify_hash(
        1, // verify_vaa_shim_program_index
        2, // wormhole_guardian_set_index
        3, // shim_guardian_signatures_index
        data.guardian_set_bump,
        keccak::Hash(fast_market_order_vaa_digest),
        accounts,
    )?;

    // Create the new fast market order account and serialize the instruction
    // data into it.

    let new_fast_market_order_info = &accounts[4];
    let (expected_fast_market_order_key, fast_market_order_bump) = Pubkey::find_program_address(
        &[
            FastMarketOrder::SEED_PREFIX,
            &fast_market_order_vaa_digest,
            fast_market_order.close_account_refund_recipient.as_ref(),
        ],
        &ID,
    );

    const DISCRIMINATOR_LEN: usize = FastMarketOrder::DISCRIMINATOR.len();
    const FAST_MARKET_ORDER_DATA_LEN: usize =
        DISCRIMINATOR_LEN + std::mem::size_of::<FastMarketOrder>();

    super::helpers::create_account_reliably(
        payer_info.key,
        &expected_fast_market_order_key,
        new_fast_market_order_info.lamports(),
        FAST_MARKET_ORDER_DATA_LEN,
        accounts,
        &ID,
        &[&[
            FastMarketOrder::SEED_PREFIX,
            &fast_market_order_vaa_digest,
            // TODO: Replace with payer_info.key.
            fast_market_order.close_account_refund_recipient.as_ref(),
            &[fast_market_order_bump],
        ]],
    )?;

    let mut new_fast_market_order_info_data = new_fast_market_order_info.try_borrow_mut_data()?;

    // Write provided fast market order data to account starting with its
    // discriminator.
    new_fast_market_order_info_data[0..DISCRIMINATOR_LEN]
        .copy_from_slice(&FastMarketOrder::DISCRIMINATOR);
    new_fast_market_order_info_data[DISCRIMINATOR_LEN..FAST_MARKET_ORDER_DATA_LEN]
        .copy_from_slice(bytemuck::bytes_of(fast_market_order));

    Ok(())
}

#[cfg(test)]
mod test {
    use crate::state::FastMarketOrderParams;

    use super::*;

    #[test]
    fn test_instruction() {
        InitializeFastMarketOrder {
            program_id: &Default::default(),
            accounts: InitializeFastMarketOrderAccounts {
                signer: &Default::default(),
                fast_market_order_account: &Default::default(),
                verify_vaa_shim_program: &Default::default(),
                guardian_set: &Default::default(),
                guardian_set_signatures: &Default::default(),
                system_program: &Default::default(),
            },
            data: InitializeFastMarketOrderData::new(
                FastMarketOrder::new(FastMarketOrderParams {
                    amount_in: Default::default(),
                    min_amount_out: Default::default(),
                    deadline: Default::default(),
                    target_chain: Default::default(),
                    redeemer_message_length: Default::default(),
                    redeemer: Default::default(),
                    sender: Default::default(),
                    refund_address: Default::default(),
                    max_fee: Default::default(),
                    init_auction_fee: Default::default(),
                    redeemer_message: [0; 512],
                    close_account_refund_recipient: Default::default(),
                    vaa_sequence: Default::default(),
                    vaa_timestamp: Default::default(),
                    vaa_nonce: Default::default(),
                    vaa_emitter_chain: Default::default(),
                    vaa_consistency_level: Default::default(),
                    vaa_emitter_address: Default::default(),
                }),
                Default::default(),
            ),
        }
        .instruction();
    }
}
