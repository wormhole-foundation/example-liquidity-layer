use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    messages::raw::LiquidityLayerMessage, wormhole_cctp_solana::wormhole::core_bridge_program,
};

use crate::{
    error::MatchingEngineError,
    state::{Custodian, RedeemedFastFill, RouterEndpoint},
};

/// Accounts required for [complete_fast_fill].
#[derive(Accounts)]
pub struct CompleteFastFill<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RedeemedFastFill::INIT_SPACE,
        seeds = [
            RedeemedFastFill::SEED_PREFIX,
            core_bridge_program::VaaAccount::load(&vaa)?.try_digest()?.as_ref()
        ],
        bump
    )]
    redeemed_fast_fill: Account<'info, RedeemedFastFill>,

    #[account(address = Pubkey::from(router_endpoint.address))]
    token_router_emitter: Signer<'info>,

    #[account(
        mut,
        token::mint = cctp_mint_recipient.mint,
        token::authority = token_router_emitter,
    )]
    token_router_custody_token: Account<'info, token::TokenAccount>,

    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            &core_bridge_program::SOLANA_CHAIN.to_be_bytes()
        ],
        bump = router_endpoint.bump,
    )]
    router_endpoint: Account<'info, RouterEndpoint>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id() @ MatchingEngineError::InvalidCustodyToken,
    )]
    cctp_mint_recipient: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// TODO: docstring
pub fn complete_fast_fill(ctx: Context<CompleteFastFill>) -> Result<()> {
    let vaa = core_bridge_program::VaaAccount::load(&ctx.accounts.vaa).unwrap();

    // Emitter must be the matching engine (this program).
    {
        let emitter = vaa.try_emitter_info()?;
        require_eq!(
            emitter.chain,
            core_bridge_program::SOLANA_CHAIN,
            MatchingEngineError::InvalidEmitterForFastFill
        );
        require_keys_eq!(
            Pubkey::from(emitter.address),
            ctx.accounts.custodian.key(),
            MatchingEngineError::InvalidEmitterForFastFill
        );

        // Fill redeemed fast fill data.
        ctx.accounts.redeemed_fast_fill.set_inner(RedeemedFastFill {
            bump: ctx.bumps.redeemed_fast_fill,
            vaa_hash: vaa.try_digest().unwrap().0,
            sequence: emitter.sequence,
        });
    }

    // Check whether this message is a deposit message we recognize.
    let msg = LiquidityLayerMessage::try_from(vaa.try_payload()?)
        .map_err(|_| error!(MatchingEngineError::InvalidVaa))?;

    // Is this a fast fill?
    let fast_fill = msg
        .fast_fill()
        .ok_or(MatchingEngineError::InvalidPayloadId)?;

    // Finally transfer to local token router's token account.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.cctp_mint_recipient.to_account_info(),
                to: ctx.accounts.token_router_custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        fast_fill.amount(),
    )
}
