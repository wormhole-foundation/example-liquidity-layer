use crate::{error::TokenRouterError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::messages::raw::LiquidityLayerDepositMessage;
use wormhole_cctp_solana::{utils::WormholeCctpPayload, wormhole::core_bridge_program};

/// Account context to invoke [redeem_fill_matching_engine].
#[derive(Accounts)]
pub struct RedeemFillMatchingEngine<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    vaa: AccountInfo<'info>,

    /// Redeemer, who owns the token account that will receive the minted tokens.
    ///
    /// CHECK: Signer must be the redeemer encoded in the Deposit Fill message.
    redeemer: Signer<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// Mutable. Seeds must be \["custody"\].
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    // add matching engine accounts here
    //
    //
    matching_engine_program: Program<'info, matching_engine::program::MatchingEngine>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// This instruction reconciles a Wormhole CCTP deposit message with a CCTP message to mint tokens
/// for the [mint_recipient](RedeemFillMatchingEngine::mint_recipient) token account.
///
/// See [verify_vaa_and_mint](wormhole_cctp_solana::cpi::verify_vaa_and_mint) for more details.
pub fn redeem_fill_matching_engine(ctx: Context<RedeemFillMatchingEngine>) -> Result<()> {
    // TODO: Placeholder for CPI call to matching engine.
    // NOTE: It is the matching engine's job to validate this VAA.

    let vaa =
        wormhole_cctp_solana::wormhole::core_bridge_program::VaaAccount::load(&ctx.accounts.vaa)
            .unwrap();

    // Wormhole CCTP deposit should be ours, so make sure this is a fill we recognize.
    let deposit = WormholeCctpPayload::try_from(vaa.try_payload().unwrap())
        .unwrap()
        .message()
        .to_deposit_unchecked();
    let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
        .map_err(|_| TokenRouterError::InvalidDepositMessage)?;

    // Verify redeemer.
    let fill = msg
        .fast_fill()
        .ok_or(TokenRouterError::InvalidPayloadId)
        .map(|fast| fast.fill())?;
    require_keys_eq!(
        Pubkey::from(fill.redeemer()),
        ctx.accounts.redeemer.key(),
        TokenRouterError::InvalidRedeemer
    );

    // Done.
    Ok(())
}
