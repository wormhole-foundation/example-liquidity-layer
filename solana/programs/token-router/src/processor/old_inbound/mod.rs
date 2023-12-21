mod native;
mod wrapped;

pub use native::*;
pub use wrapped::*;

use crate::{
    error::TokenRouterError,
    state::{RedeemerConfig, RegisteredAsset},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use wormhole_anchor_sdk::token_bridge;

pub struct RedeemToken<'ctx, 'info> {
    payer: &'ctx Signer<'info>,
    config: &'ctx Account<'info, RedeemerConfig>,
    fee_recipient_token_account: &'ctx Account<'info, TokenAccount>,
    mint: &'ctx Account<'info, Mint>,
    recipient_token_account: &'ctx Account<'info, TokenAccount>,
    recipient: &'ctx AccountInfo<'info>,
    registered_asset: &'ctx Account<'info, RegisteredAsset>,
    native_registered_token: &'ctx Account<'info, RegisteredAsset>,
    tmp_token_account: &'ctx Account<'info, TokenAccount>,
    token_program: &'ctx Program<'info, Token>,
    system_program: &'ctx Program<'info, System>,
}

pub fn redeem_token(
    redeem_token: RedeemToken,
    amount: u64,
    denormalized_relayer_fee: u64,
    to_native_token_amount: u64,
) -> Result<()> {
    let RedeemToken {
        payer,
        config,
        fee_recipient_token_account,
        mint,
        recipient_token_account,
        recipient,
        registered_asset,
        native_registered_token,
        tmp_token_account,
        token_program,
        system_program,
    } = redeem_token;

    let config_seeds = &[RedeemerConfig::SEED_PREFIX.as_ref(), &[config.bump]];

    // Handle self redemptions. If the payer is the recipient, we should
    // send the entire transfer amount.
    if payer.key() == recipient.key() {
        // Transfer tokens from tmp_token_account to recipient.
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: tmp_token_account.to_account_info(),
                    to: recipient_token_account.to_account_info(),
                    authority: config.to_account_info(),
                },
                &[&config_seeds[..]],
            ),
            amount,
        )?;
    } else {
        // Denormalize the to_native_token_amount.
        let denormalized_to_native_token_amount =
            token_bridge::denormalize_amount(to_native_token_amount, mint.decimals);

        // Calculate the amount of SOL that should be sent to the
        // recipient.
        let (token_amount_in, native_amount_out) = registered_asset
            .calculate_native_swap_amounts(
                mint.decimals,
                native_registered_token.swap_rate,
                denormalized_to_native_token_amount,
            )
            .ok_or(TokenRouterError::InvalidSwapCalculation)?;

        // Transfer lamports from the payer to the recipient if the
        // native_amount_out is nonzero.
        if native_amount_out > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: payer.to_account_info(),
                        to: recipient.to_account_info(),
                    },
                ),
                native_amount_out,
            )?;

            msg!(
                "Swap executed successfully, recipient: {}, relayer: {}, token: {}, tokenAmount: {}, nativeAmount: {}",
                recipient.key(),
                payer.key(),
                mint.key(),
                token_amount_in,
                native_amount_out
            );
        }

        // Calculate the amount for the fee recipient.
        let amount_for_fee_recipient = token_amount_in + denormalized_relayer_fee;

        // Transfer tokens from tmp_token_account to the fee recipient.
        if amount_for_fee_recipient > 0 {
            anchor_spl::token::transfer(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    anchor_spl::token::Transfer {
                        from: tmp_token_account.to_account_info(),
                        to: fee_recipient_token_account.to_account_info(),
                        authority: config.to_account_info(),
                    },
                    &[&config_seeds[..]],
                ),
                amount_for_fee_recipient,
            )?;
        }

        // Transfer tokens from tmp_token_account to recipient.
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: tmp_token_account.to_account_info(),
                    to: recipient_token_account.to_account_info(),
                    authority: config.to_account_info(),
                },
                &[&config_seeds[..]],
            ),
            amount - amount_for_fee_recipient,
        )?;
    }

    // Finish instruction by closing tmp_token_account.
    anchor_spl::token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        anchor_spl::token::CloseAccount {
            account: tmp_token_account.to_account_info(),
            destination: payer.to_account_info(),
            authority: config.to_account_info(),
        },
        &[&config_seeds[..]],
    ))
}
