use crate::{
    error::TokenRouterError,
    state::{Custodian, PayerSequence, RegisteredContract},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use ruint::aliases::U256;
use wormhole_cctp_program::sdk::{
    self as wormhole_cctp, cctp_message_transmitter, cctp_token_messenger_minter, core_bridge,
    io::TypePrefixedPayload,
};

const MESSAGE_SEED_PREFIX: &[u8] = b"msg";

#[derive(Accounts)]
pub struct TransferTokensWithRelay<'info> {
    /// Payer will pay Wormhole fee to transfer tokens and create temporary
    /// token account.
    #[account(mut)]
    payer: Signer<'info>,

    /// Sender Config account. Acts as the signer for the Token Bridge token
    /// transfer. Read-only.
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump,
        constraint = !custodian.paused @ TokenRouterError::OutboundTransfersPaused
    )]
    custodian: Account<'info, Custodian>,

    /// Used to keep track of payer's sequence number.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PayerSequence::INIT_SPACE,
        seeds = [
            PayerSequence::SEED_PREFIX,
            payer.key().as_ref()
        ],
        bump,
    )]
    payer_sequence: Account<'info, PayerSequence>,

    /// Foreign Contract account. Send tokens to the contract specified in this
    /// account. Funnily enough, the Token Bridge program does not have any
    /// requirements for outbound transfers for the recipient chain to be
    /// registered. This account provides extra protection against sending
    /// tokens to an unregistered Wormhole chain ID. Read-only.
    #[account(
        seeds = [
            RegisteredContract::SEED_PREFIX,
            &registered_contract.chain.to_be_bytes()
        ],
        bump = registered_contract.bump,
        constraint = registered_contract.relayer_fee(&mint.key()).is_some() @ TokenRouterError::TokenNotRegistered,
    )]
    registered_contract: Account<'info, RegisteredContract>,

    /// CHECK: TODO
    #[account(mut)]
    mint: AccountInfo<'info>,

    /// Payer's associated token account. We may want to make this a generic
    /// token account in the future.
    ///
    /// CHECK: Wormhole CCTP checks that the token mint is the same as the mint provided in its
    /// account context. Transfer authority must be set to the payer.
    #[account(mut)]
    from_token: AccountInfo<'info>,

    /// CHECK: Wormhole Message. Token Bridge program writes info about the
    /// tokens transferred in this account for our program. Mutable.
    #[account(
        mut,
        seeds = [
            MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            &payer_sequence.to_be_bytes()
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    /// NOTE: This account needs to be boxed because without it we hit stack overflow.
    #[account(
        init,
        payer = payer,
        token::mint = mint,
        token::authority = custodian,
        seeds = [crate::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump,
    )]
    custody_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: TODO
    worm_cctp_custodian: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    worm_cctp_custody_token: UncheckedAccount<'info>,

    /// CHECK: TODO
    worm_cctp_registered_emitter: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    core_bridge_config: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    core_fee_collector: UncheckedAccount<'info>,

    /// CHECK: TODO
    cctp_token_messenger_minter_sender_authority: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    cctp_message_transmitter_config: UncheckedAccount<'info>,

    /// CHECK: TODO
    cctp_token_messenger: UncheckedAccount<'info>,

    /// CHECK: TODO
    cctp_remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK: TODO
    cctp_token_minter: UncheckedAccount<'info>,

    /// CHECK: TODO
    #[account(mut)]
    cctp_local_token: AccountInfo<'info>,

    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    wormhole_cctp_program: Program<'info, wormhole_cctp::WormholeCctp>,
    core_bridge_program: Program<'info, core_bridge::CoreBridge>,
    cctp_token_messenger_minter_program:
        Program<'info, cctp_token_messenger_minter::TokenMessengerMinter>,
    cctp_message_transmitter_program: Program<'info, cctp_message_transmitter::MessageTransmitter>,

    /// CHECK: Clock sysvar.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Rent sysvar.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransferTokensWithRelayArgs {
    pub amount: u64,
    pub to_native_token_amount: u64,
    pub target_recipient_wallet: [u8; 32],
}

pub fn transfer_tokens_with_relay(
    ctx: Context<TransferTokensWithRelay>,
    args: TransferTokensWithRelayArgs,
) -> Result<()> {
    let TransferTokensWithRelayArgs {
        amount,
        to_native_token_amount,
        target_recipient_wallet,
    } = args;
    require!(
        target_recipient_wallet != [0; 32],
        TokenRouterError::InvalidRecipient
    );

    // This operation is safe to unwrap because we checked that the relayer fee
    // exists in the account context.
    let relayer_fee = ctx
        .accounts
        .registered_contract
        .relayer_fee(&ctx.accounts.mint.key())
        .unwrap();

    // Confirm that the amount specified is at least the relayer fee plus the
    // amount desired for native currency. This also implicitly checks that the
    // amount is non-zero.
    require!(
        amount > relayer_fee + to_native_token_amount,
        TokenRouterError::ZeroBridgeAmount
    );

    // These seeds are used to:
    // 1.  Sign the Sender Config's token account to delegate approval
    //     of truncated_amount.
    // 2.  Sign Token Bridge program's transfer_native instruction.
    // 3.  Close tmp_token_account.
    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.from_token.to_account_info(),
                to: ctx.accounts.custody_token.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[custodian_seeds],
        ),
        amount,
    )?;

    let msg = crate::messages::TransferTokensWithRelay {
        target_relayer_fee: U256::from(relayer_fee),
        to_native_token_amount: U256::from(to_native_token_amount),
        target_recipient_wallet,
    };

    let mut payload = Vec::with_capacity(msg.payload_written_size());
    let mut writer = std::io::Cursor::new(&mut payload);
    msg.write_typed(&mut writer).unwrap();

    // Holy accounts, Batman!
    wormhole_cctp::transfer_tokens_with_payload(
        CpiContext::new_with_signer(
            ctx.accounts.wormhole_cctp_program.to_account_info(),
            wormhole_cctp::TransferTokensWithPayload {
                payer: ctx.accounts.payer.to_account_info(),
                custodian: ctx.accounts.worm_cctp_custodian.to_account_info(),
                burn_source_authority: ctx.accounts.custodian.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                burn_source: ctx.accounts.custody_token.to_account_info(),
                custody_token: ctx.accounts.worm_cctp_custody_token.to_account_info(),
                registered_emitter: ctx.accounts.worm_cctp_registered_emitter.to_account_info(),
                core_bridge_config: ctx.accounts.core_bridge_config.to_account_info(),
                core_message: ctx.accounts.core_message.to_account_info(),
                core_emitter_sequence: ctx.accounts.core_emitter_sequence.to_account_info(),
                core_fee_collector: ctx.accounts.core_fee_collector.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .cctp_token_messenger_minter_sender_authority
                    .to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .cctp_message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.cctp_token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.cctp_remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.cctp_token_minter.to_account_info(),
                local_token: ctx.accounts.cctp_local_token.to_account_info(),
                core_bridge_program: ctx.accounts.core_bridge_program.to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .cctp_token_messenger_minter_program
                    .to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .cctp_message_transmitter_program
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                custodian_seeds,
                &[
                    MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    &ctx.accounts.payer_sequence.take_and_uptick().to_be_bytes(),
                    &[ctx.bumps["core_message"]],
                ],
            ],
        ),
        wormhole_cctp::TransferTokensWithPayloadArgs {
            amount,
            mint_recipient: ctx.accounts.registered_contract.address,
            nonce: 0,
            payload,
        },
    )?;

    // Finally close the custody token account.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.custody_token.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[custodian_seeds],
    ))
}
