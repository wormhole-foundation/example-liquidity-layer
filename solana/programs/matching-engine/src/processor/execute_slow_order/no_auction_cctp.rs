use std::io::Write;

use crate::state::{AuctionData, AuctionStatus, Custodian, PayerSequence, RouterEndpoint};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;
use wormhole_cctp_solana::{
    cctp::{message_transmitter_program, token_messenger_minter_program},
    wormhole::core_bridge_program::{self, VaaAccount},
};

use super::CctpMessageArgs;

#[derive(Accounts)]
pub struct ExecuteSlowOrderNoAuctionCctp<'info> {
    #[account(mut)]
    payer: Signer<'info>,

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

    /// This program's Wormhole (Core Bridge) emitter authority.
    ///
    /// CHECK: Seeds must be \["emitter"\].
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = custodian.bump,
        has_one = fee_recipient, // TODO: add error
    )]
    custodian: Account<'info, Custodian>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    fast_vaa: AccountInfo<'info>,

    /// CHECK: Must be owned by the Wormhole Core Bridge program. This account will be read via
    /// zero-copy using the [VaaAccount](core_bridge_program::sdk::VaaAccount) reader.
    #[account(owner = core_bridge_program::id())]
    finalized_vaa: AccountInfo<'info>,

    /// There should be no account data here because an auction was never created.
    #[account(
        init,
        payer = payer,
        space = 8 + AuctionData::INIT_SPACE,
        seeds = [
            AuctionData::SEED_PREFIX,
            VaaAccount::load(&fast_vaa)?.try_digest()?.as_ref(),
        ],
        bump,
    )]
    auction_data: Account<'info, AuctionData>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    fee_recipient: AccountInfo<'info>,

    /// Mint recipient token account, which is encoded as the mint recipient in the CCTP message.
    /// The CCTP Token Messenger Minter program will transfer the amount encoded in the CCTP message
    /// from its custody account to this account.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    ///
    /// NOTE: This account must be encoded as the mint recipient in the CCTP message.
    #[account(
        mut,
        seeds = [common::constants::CUSTODY_TOKEN_SEED_PREFIX],
        bump = custodian.custody_token_bump,
    )]
    custody_token: AccountInfo<'info>,

    /// Circle-supported mint.
    ///
    /// CHECK: Mutable. This token account's mint must be the same as the one found in the CCTP
    /// Token Messenger Minter program's local token account.
    #[account(
        mut,
        address = common::constants::usdc::id(),
    )]
    mint: AccountInfo<'info>,

    /// Seeds must be \["endpoint", chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            from_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = from_router_endpoint.bump,
    )]
    from_router_endpoint: Account<'info, RouterEndpoint>,

    /// Seeds must be \["endpoint", chain.to_be_bytes()\].
    #[account(
        seeds = [
            RouterEndpoint::SEED_PREFIX,
            to_router_endpoint.chain.to_be_bytes().as_ref(),
        ],
        bump = to_router_endpoint.bump,
    )]
    to_router_endpoint: Account<'info, RouterEndpoint>,

    /// CHECK: Seeds must be \["message_transmitter_authority"\] (CCTP Message Transmitter program).
    message_transmitter_authority: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["message_transmitter"\] (CCTP Message Transmitter program).
    message_transmitter_config: AccountInfo<'info>,

    /// CHECK: Mutable. Seeds must be \["used_nonces", remote_domain.to_string(),
    /// first_nonce.to_string()\] (CCTP Message Transmitter program).
    #[account(mut)]
    used_nonces: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_messenger"\] (CCTP Token Messenger Minter program).
    token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["remote_token_messenger"\, remote_domain.to_string()] (CCTP Token
    /// Messenger Minter program).
    remote_token_messenger: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_minter"\] (CCTP Token Messenger Minter program).
    token_minter: UncheckedAccount<'info>,

    /// Token Messenger Minter's Local Token account. This program uses the mint of this account to
    /// validate the `mint_recipient` token account's mint.
    ///
    /// CHECK: Mutable. Seeds must be \["local_token", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    local_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["token_pair", remote_domain.to_string(), remote_token_address\] (CCTP
    /// Token Messenger Minter program).
    token_pair: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["custody", mint\] (CCTP Token Messenger Minter program).
    #[account(mut)]
    token_messenger_minter_custody_token: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["Bridge"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_bridge_config: UncheckedAccount<'info>,

    /// CHECK: Mutable. Seeds must be \["msg", payer, payer_sequence.value\].
    #[account(
        mut,
        seeds = [
            common::constants::CORE_MESSAGE_SEED_PREFIX,
            payer.key().as_ref(),
            payer_sequence.value.to_be_bytes().as_ref(),
        ],
        bump,
    )]
    core_message: AccountInfo<'info>,

    /// CHECK: Seeds must be \["Sequence"\, custodian] (Wormhole Core Bridge program).
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["fee_collector"\] (Wormhole Core Bridge program).
    #[account(mut)]
    core_fee_collector: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["sender_authority"\] (CCTP Token Messenger Minter program).
    token_messenger_minter_sender_authority: UncheckedAccount<'info>,

    core_bridge_program: Program<'info, core_bridge_program::CoreBridge>,
    token_messenger_minter_program:
        Program<'info, token_messenger_minter_program::TokenMessengerMinter>,
    message_transmitter_program: Program<'info, message_transmitter_program::MessageTransmitter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,

    /// CHECK: Wormhole Core Bridge needs the clock sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::clock::id())]
    clock: AccountInfo<'info>,

    /// CHECK: Wormhole Core Bridge needs the rent sysvar based on its legacy implementation.
    #[account(address = solana_program::sysvar::rent::id())]
    rent: AccountInfo<'info>,
}

pub fn execute_slow_order_no_auction_cctp(
    ctx: Context<ExecuteSlowOrderNoAuctionCctp>,
    args: CctpMessageArgs,
) -> Result<()> {
    let fast_vaa = VaaAccount::load(&ctx.accounts.fast_vaa).unwrap();

    // NOTE: We do not need the return values here for this instruction.
    let (order, base_fee) = super::prepare_execute_slow_order(
        &fast_vaa,
        super::PrepareExecuteSlowOrder {
            payer: &ctx.accounts.payer,
            custodian: &ctx.accounts.custodian,
            finalized_vaa: &ctx.accounts.finalized_vaa,
            custody_token: ctx.accounts.custody_token.as_ref(),
            message_transmitter_authority: &ctx.accounts.message_transmitter_authority,
            message_transmitter_config: &ctx.accounts.message_transmitter_config,
            used_nonces: &ctx.accounts.used_nonces,
            token_messenger: &ctx.accounts.token_messenger,
            remote_token_messenger: &ctx.accounts.remote_token_messenger,
            token_minter: &ctx.accounts.token_minter,
            local_token: &ctx.accounts.local_token,
            token_pair: &ctx.accounts.token_pair,
            token_messenger_minter_custody_token: &ctx
                .accounts
                .token_messenger_minter_custody_token,
            message_transmitter_program: &ctx.accounts.message_transmitter_program,
            token_messenger_minter_program: &ctx.accounts.token_messenger_minter_program,
            token_program: &ctx.accounts.token_program,
            system_program: &ctx.accounts.system_program,
        },
        args,
    )?;

    // NOTE: We need to verify the router path, since an auction was never created and this check is
    // done in the `place_initial_offer` instruction.
    crate::utils::verify_router_path(
        &fast_vaa,
        &ctx.accounts.from_router_endpoint,
        &ctx.accounts.to_router_endpoint,
        order.target_chain(),
    )?;

    let custodian_seeds = &[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]];

    // TODO: encoding will change from u128 to u64
    let amount = u64::try_from(order.amount_in() - base_fee).unwrap();
    let mut redeemer_message = Vec::with_capacity(order.redeemer_message_len().try_into().unwrap());
    redeemer_message.write_all(order.redeemer_message().into())?;

    // This returns the CCTP nonce, but we do not need it.
    wormhole_cctp_solana::cpi::burn_and_publish(
        CpiContext::new_with_signer(
            ctx.accounts
                .token_messenger_minter_program
                .to_account_info(),
            wormhole_cctp_solana::cpi::DepositForBurnWithCaller {
                src_token_owner: ctx.accounts.custodian.to_account_info(),
                token_messenger_minter_sender_authority: ctx
                    .accounts
                    .token_messenger_minter_sender_authority
                    .to_account_info(),
                src_token: ctx.accounts.custody_token.to_account_info(),
                message_transmitter_config: ctx
                    .accounts
                    .message_transmitter_config
                    .to_account_info(),
                token_messenger: ctx.accounts.token_messenger.to_account_info(),
                remote_token_messenger: ctx.accounts.remote_token_messenger.to_account_info(),
                token_minter: ctx.accounts.token_minter.to_account_info(),
                local_token: ctx.accounts.local_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                message_transmitter_program: ctx
                    .accounts
                    .message_transmitter_program
                    .to_account_info(),
                token_messenger_minter_program: ctx
                    .accounts
                    .token_messenger_minter_program
                    .to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            &[custodian_seeds],
        ),
        CpiContext::new_with_signer(
            ctx.accounts.core_bridge_program.to_account_info(),
            wormhole_cctp_solana::cpi::PostMessage {
                payer: ctx.accounts.payer.to_account_info(),
                message: ctx.accounts.core_message.to_account_info(),
                emitter: ctx.accounts.custodian.to_account_info(),
                config: ctx.accounts.core_bridge_config.to_account_info(),
                emitter_sequence: ctx.accounts.core_emitter_sequence.to_account_info(),
                fee_collector: ctx.accounts.core_fee_collector.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                clock: ctx.accounts.clock.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[
                custodian_seeds,
                &[
                    common::constants::CORE_MESSAGE_SEED_PREFIX,
                    ctx.accounts.payer.key().as_ref(),
                    ctx.accounts
                        .payer_sequence
                        .take_and_uptick()
                        .to_be_bytes()
                        .as_ref(),
                    &[ctx.bumps["core_message"]],
                ],
            ],
        ),
        wormhole_cctp_solana::cpi::BurnAndPublishArgs {
            burn_source: ctx.accounts.custody_token.key(),
            destination_caller: ctx.accounts.to_router_endpoint.address,
            destination_cctp_domain: order.destination_cctp_domain(),
            amount,
            // TODO: add mint recipient to the router endpoint account to future proof this?
            mint_recipient: ctx.accounts.to_router_endpoint.address,
            wormhole_message_nonce: common::constants::WORMHOLE_MESSAGE_NONCE,
            payload: common::messages::Fill {
                source_chain: ctx.accounts.from_router_endpoint.chain,
                order_sender: order.sender(),
                redeemer: order.redeemer(),
                redeemer_message: redeemer_message.into(),
            }
            .to_vec_payload(),
        },
    )?;

    // TODO:

    // sequence = _handleCctpTransfer(order.amountIn - baseFee, cctpVaa.emitterChainId, order);

    // This is a necessary security check. This will prevent a relayer from starting an auction with
    // the fast transfer VAA, even though the slow relayer already delivered the slow VAA. Not
    // setting this could lead to trapped funds (which would require an upgrade to fix).
    //
    // NOTE: We do not bother setting the other fields in this account. The existence of this
    // accounts ensures the security defined in the previous paragraph.
    ctx.accounts.auction_data.status = AuctionStatus::Completed;

    // Pay the `fee_recipient` the base fee. This ensures that the protocol relayer is paid for
    // relaying slow VAAs that do not have an associated auction. This prevents the protocol relayer
    // from any MEV attacks.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.custody_token.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[&[Custodian::SEED_PREFIX, &[ctx.accounts.custodian.bump]]],
        ),
        // TODO: encoding will change from u128 to u64
        base_fee.try_into().unwrap(),
    )
}
