cfg_if::cfg_if! {
    if #[cfg(feature = "mainnet")] {
        anchor_lang::declare_id!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    } else if #[cfg(feature = "testnet")] {
        anchor_lang::declare_id!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    } else if #[cfg(feature = "localnet")] {
        anchor_lang::declare_id!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    }
}
