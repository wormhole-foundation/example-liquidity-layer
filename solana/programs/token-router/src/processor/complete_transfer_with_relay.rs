use crate::{
    error::TokenRouterError,
    state::{Custodian, RegisteredAsset, RegisteredContract},
};
use anchor_lang::{
    prelude::*,
    system_program::{self, Transfer},
};
use anchor_spl::token;
use wormhole_cctp_program::sdk as wormhole_cctp;

#[derive(Accounts)]
#[instruction(vaa_hash: [u8; 32])]
pub struct CompleteNativeWithRelay<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: We will be performing zero-copy deserialization in the instruction handler.
    #[account(owner = wormhole_cctp::core_bridge::id())]
    vaa: AccountInfo<'info>,

    /// CHECK: This account is needed to create the temporary custody token account.
    #[account(address = registered_asset.mint)]
    mint: AccountInfo<'info>,

    /// Fee recipient's token account. Must be an associated token account. Mutable.
    #[account(
        mut,
        associated_token::mint = registered_asset.mint,
        associated_token::authority = custodian.fee_recipient
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    #[account(
        mut,
        associated_token::mint = registered_asset.mint,
        associated_token::authority = recipient
    )]
    recipient_token: Account<'info, token::TokenAccount>,

    /// Foreign Contract account. The registered contract specified in this
    /// account must agree with the target address for the Token Bridge's token
    /// transfer. Read-only.
    #[account(
        seeds = [
            RegisteredContract::SEED_PREFIX,
            &try_vaa(&vaa, |vaa| vaa.try_emitter_chain())?.to_be_bytes()
        ],
        bump = registered_contract.bump,
        constraint = try_vaa(&vaa, |vaa| vaa.try_emitter_address())? == registered_contract.address @ TokenRouterError::InvalidEndpoint
    )]
    registered_contract: Account<'info, RegisteredContract>,

    #[account(
        seeds = [
            RegisteredAsset::SEED_PREFIX,
            registered_asset.mint.as_ref()
        ],
        bump = registered_asset.bump,
    )]
    // Registered token account for the specified mint. This account stores
    // information about the token. Read-only.
    registered_asset: Account<'info, RegisteredAsset>,

    #[account(mut)]
    /// CHECK: recipient may differ from payer if a relayer paid for this
    /// transaction. This instruction verifies that the recipient key
    /// passed in this context matches the intended recipient in the vaa.
    recipient: AccountInfo<'info>,

    /// Program's temporary token account. This account is created before the
    /// instruction is invoked to temporarily take custody of the payer's
    /// tokens. When the tokens are finally bridged in, the tokens will be
    /// transferred to the destination token accounts. This account will have
    /// zero balance and can be closed.
    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = custodian,
        seeds = [crate::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump,
    )]
    custody_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        constraint = worm_cctp_claim.data_is_empty() @ TokenRouterError::AlreadyRedeemed
    )]
    worm_cctp_claim: AccountInfo<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    wormhole_cctp_program: Program<'info, wormhole_cctp::WormholeCctp>,
}

pub fn complete_native_transfer_with_relay(
    ctx: Context<CompleteNativeWithRelay>,
    _vaa_hash: [u8; 32],
) -> Result<()> {
    // The intended recipient must agree with the recipient account.
    let TokenBridgeRelayerMessage::TransferWithRelay {
        target_relayer_fee,
        to_native_token_amount,
        recipient,
    } = *ctx.accounts.vaa.message().data();
    require!(
        ctx.accounts.recipient.key() == Pubkey::from(recipient),
        TokenRouterError::InvalidRecipient
    );

    // These seeds are used to:
    // 1.  Redeem Token Bridge program's
    //     complete_transfer_native_with_payload.
    // 2.  Transfer tokens to relayer if it exists.
    // 3.  Transfer remaining tokens to recipient.
    // 4.  Close tmp_token_account.
    let config_seeds = &[
        RedeemerConfig::SEED_PREFIX.as_ref(),
        &[ctx.accounts.config.bump],
    ];

    // Redeem the token transfer to the tmp_token_account.
    token_bridge::complete_transfer_native_with_payload(CpiContext::new_with_signer(
        ctx.accounts.token_bridge_program.to_account_info(),
        token_bridge::CompleteTransferNativeWithPayload {
            payer: ctx.accounts.payer.to_account_info(),
            config: ctx.accounts.token_bridge_config.to_account_info(),
            vaa: ctx.accounts.vaa.to_account_info(),
            claim: ctx.accounts.token_bridge_claim.to_account_info(),
            foreign_endpoint: ctx.accounts.token_bridge_foreign_endpoint.to_account_info(),
            to: ctx.accounts.tmp_token_account.to_account_info(),
            redeemer: ctx.accounts.config.to_account_info(),
            custody: ctx.accounts.token_bridge_custody.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            custody_signer: ctx.accounts.token_bridge_custody_signer.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            wormhole_program: ctx.accounts.wormhole_program.to_account_info(),
        },
        &[config_seeds],
    ))?;

    // Denormalize the transfer amount and target relayer fee encoded in
    // the VAA.
    let amount = token_bridge::denormalize_amount(
        ctx.accounts.vaa.data().amount(),
        ctx.accounts.mint.decimals,
    );
    let denormalized_relayer_fee =
        token_bridge::denormalize_amount(target_relayer_fee, ctx.accounts.mint.decimals);

    // Check to see if the transfer is for wrapped SOL. If it is,
    // unwrap and transfer the SOL to the recipient and relayer.
    // Since we are unwrapping the SOL, this contract will not
    // perform a swap with the off-chain relayer.
    if ctx.accounts.mint.key() == spl_token::native_mint::ID {
        // Transfer all lamports to the payer.
        anchor_spl::token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::CloseAccount {
                account: ctx.accounts.tmp_token_account.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[config_seeds],
        ))?;

        // If the payer is a relayer, we need to send the expected lamports
        // to the recipient, less the relayer fee.
        if ctx.accounts.payer.key() != ctx.accounts.recipient.key() {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.recipient.to_account_info(),
                    },
                ),
                amount - denormalized_relayer_fee,
            )
        } else {
            Ok(())
        }
    } else {
        redeem_token(
            RedeemToken {
                payer: &ctx.accounts.payer,
                config: &ctx.accounts.config,
                fee_recipient_token_account: &ctx.accounts.fee_recipient_token_account,
                mint: &ctx.accounts.mint,
                recipient_token_account: &ctx.accounts.recipient_token_account,
                recipient: &ctx.accounts.recipient,
                registered_asset: &ctx.accounts.registered_asset,
                native_registered_token: &ctx.accounts.native_registered_token,
                tmp_token_account: &ctx.accounts.tmp_token_account,
                token_program: &ctx.accounts.token_program,
                system_program: &ctx.accounts.system_program,
            },
            amount,
            denormalized_relayer_fee,
            to_native_token_amount,
        )
    }
}

fn try_vaa<F, T>(vaa_acc_info: &AccountInfo, func: F) -> Result<T>
where
    T: std::fmt::Debug,
    F: FnOnce(wormhole_cctp::VaaAccount) -> Result<T>,
{
    wormhole_cctp::VaaAccount::load(vaa_acc_info).and_then(func)
}
