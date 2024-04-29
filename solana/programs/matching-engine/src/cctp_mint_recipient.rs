use anchor_lang::prelude::declare_id;

cfg_if::cfg_if! {
    if #[cfg(feature = "testnet")] {
        declare_id!("6yKmqWarCry3c8ntYKzM4WiS2fVypxLbENE2fP8onJje");
    } else if #[cfg(feature = "localnet")] {
        declare_id!("35iwWKi7ebFyXNaqpswd1g9e9jrjvqWPV39nCQPaBbX1");
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
                &common::USDC_MINT,
            ),
            "custody ata mismatch"
        );
    }
}
