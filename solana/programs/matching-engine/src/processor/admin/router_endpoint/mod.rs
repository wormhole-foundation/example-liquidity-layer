mod add;
pub use add::*;

mod disable;
pub use disable::*;

mod update;
pub use update::*;

pub mod local_token_router {
    use crate::error::MatchingEngineError;
    use anchor_lang::prelude::*;

    #[derive(Accounts)]
    pub struct LocalTokenRouter<'info> {
        /// CHECK: Must be an executable (the Token Router program), whose ID will be used to derive the
        /// emitter (router endpoint) address.
        #[account(executable)]
        pub token_router_program: AccountInfo<'info>,

        /// CHECK: The Token Router program's emitter PDA (a.k.a. its custodian) will have account data.
        #[account(
            seeds = [b"emitter"],
            bump,
            seeds::program = token_router_program,
            owner = token_router_program.key() @ MatchingEngineError::InvalidEndpoint,
            constraint = !token_router_emitter.data_is_empty() @ MatchingEngineError::InvalidEndpoint,
        )]
        pub token_router_emitter: AccountInfo<'info>,

        #[account(
            associated_token::mint = common::constants::USDC_MINT,
            associated_token::authority = token_router_emitter,
        )]
        pub token_router_mint_recipient: Account<'info, anchor_spl::token::TokenAccount>,
    }
}
