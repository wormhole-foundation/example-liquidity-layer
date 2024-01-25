use anchor_lang::prelude::declare_id;

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        declare_id!("5T6PsQ8m8xtU5sX51LGKV2EXwHzX5pF6nKoKndp7QUNQ");
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
