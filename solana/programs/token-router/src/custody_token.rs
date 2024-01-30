use anchor_lang::prelude::declare_id;

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        declare_id!("EPEpG3P1Vvak3stx7RnwQD9vWFLpWzpXnbfXc1owrD7o");
    } else if #[cfg(feature = "localnet")] {
        declare_id!("EkC51gZDovMhsZCN8KYYY7GoVs3Pi5WQ1hfUw1kR7462");
    }
}

#[cfg(test)]
mod test {
    use solana_program::pubkey::Pubkey;

    #[test]
    fn test_ata_address() {
        let custodian =
            Pubkey::create_program_address(crate::state::Custodian::SIGNER_SEEDS, &crate::id())
                .unwrap();
        assert_eq!(
            super::id(),
            anchor_spl::associated_token::get_associated_token_address(
                &custodian,
                &common::constants::usdc::id()
            ),
            "custody ata mismatch"
        );
    }
}
