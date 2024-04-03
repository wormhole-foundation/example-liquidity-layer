use std::ops::Deref;

use crate::{
    error::TokenRouterError,
    state::{Custodian, PreparedFill},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::{
    admin::utils::{assistant::only_authorized, ownable::only_owner},
    messages::raw::{LiquidityLayerDepositMessage, LiquidityLayerMessage, LiquidityLayerPayload},
    wormhole_cctp_solana::wormhole::VaaAccount,
};

#[derive(Accounts)]
pub struct Usdc<'info> {
    /// CHECK: This address must equal [USDC_MINT](common::USDC_MINT).
    #[account(address = common::USDC_MINT)]
    pub mint: AccountInfo<'info>,
}

impl<'info> Deref for Usdc<'info> {
    type Target = AccountInfo<'info>;

    fn deref(&self) -> &Self::Target {
        &self.mint
    }
}

/// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
/// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
/// from its custody account to this account.
///
/// CHECK: Mutable. Seeds must be \["custody"\].
///
/// NOTE: This account must be encoded as the mint recipient in the CCTP message.
#[derive(Accounts)]
pub struct CctpMintRecipientMut<'info> {
    #[account(
        mut,
        address = crate::cctp_mint_recipient::id()
    )]
    pub mint_recipient: Box<Account<'info, token::TokenAccount>>,
}

impl<'info> Deref for CctpMintRecipientMut<'info> {
    type Target = Account<'info, token::TokenAccount>;

    fn deref(&self) -> &Self::Target {
        &self.mint_recipient
    }
}

#[derive(Accounts)]
pub struct LiquidityLayerVaa<'info> {
    /// CHECK: This VAA account must be a posted VAA from the Wormhole Core Bridge program.
    #[account(
        constraint = {
            // NOTE: This load performs an owner check.
            let vaa = VaaAccount::load(&vaa)?;

            // Is it a legitimate LL message?
            LiquidityLayerPayload::try_from(vaa.payload()).map_err(|_| TokenRouterError::InvalidVaa)?;

            // Done.
            true
        }
    )]
    pub vaa: AccountInfo<'info>,
}

impl<'info> LiquidityLayerVaa<'info> {
    pub fn load_unchecked(&self) -> VaaAccount<'_> {
        VaaAccount::load_unchecked(self)
    }
}

impl<'info> Deref for LiquidityLayerVaa<'info> {
    type Target = AccountInfo<'info>;

    fn deref(&self) -> &Self::Target {
        &self.vaa
    }
}

#[derive(Accounts)]
pub struct CheckedCustodian<'info> {
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.custodian
    }
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(TokenRouterError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnlyMut<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(TokenRouterError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(TokenRouterError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct AdminMut<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(TokenRouterError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct InitIfNeededPreparedFill<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub fill_vaa: LiquidityLayerVaa<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = compute_prepared_fill_size(&fill_vaa)?,
        seeds = [
            PreparedFill::SEED_PREFIX,
            fill_vaa.load_unchecked().digest().as_ref(),
        ],
        bump,
    )]
    pub prepared_fill: Account<'info, PreparedFill>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(
        init_if_needed,
        payer = payer,
        token::mint = usdc,
        token::authority = prepared_fill,
        seeds = [
            crate::PREPARED_CUSTODY_TOKEN_SEED_PREFIX,
            prepared_fill.key().as_ref(),
        ],
        bump,
    )]
    pub custody_token: Account<'info, token::TokenAccount>,

    pub usdc: Usdc<'info>,

    pub token_program: Program<'info, token::Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deref for InitIfNeededPreparedFill<'info> {
    type Target = Account<'info, PreparedFill>;

    fn deref(&self) -> &Self::Target {
        &self.prepared_fill
    }
}

fn compute_prepared_fill_size(vaa_acc_info: &AccountInfo<'_>) -> Result<usize> {
    let vaa = VaaAccount::load(vaa_acc_info)?;
    let msg = LiquidityLayerMessage::try_from(vaa.payload()).unwrap();

    match msg {
        LiquidityLayerMessage::Deposit(deposit) => {
            let msg = LiquidityLayerDepositMessage::try_from(deposit.payload())
                .map_err(|_| TokenRouterError::InvalidDepositMessage)?;
            let fill = msg.fill().ok_or(TokenRouterError::InvalidPayloadId)?;
            Ok(fill
                .redeemer_message_len()
                .try_into()
                .map(PreparedFill::compute_size)
                .unwrap())
        }
        LiquidityLayerMessage::FastFill(fast_fill) => Ok(fast_fill
            .fill()
            .redeemer_message_len()
            .try_into()
            .map(PreparedFill::compute_size)
            .unwrap()),
        _ => err!(TokenRouterError::InvalidPayloadId),
    }
}
