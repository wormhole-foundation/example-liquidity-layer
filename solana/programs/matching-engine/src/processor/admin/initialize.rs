use crate::{
    error::MatchingEngineError,
    processor::shared_contexts::*,
    state::{AuctionConfig, Custodian},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

// Because this is used as the args for initialize, we'll make it public here.
pub use crate::state::AuctionParameters;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Owner of the program, who presumably deployed this program.
    #[account(mut)]
    owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Custodian::INIT_SPACE,
        seeds = [Custodian::SEED_PREFIX],
        bump,
    )]
    /// Custodian account, which saves program data useful for other
    /// instructions.
    custodian: Account<'info, Custodian>,

    #[account(
        init,
        payer = owner,
        space = 8 + AuctionConfig::INIT_SPACE,
        seeds = [
            AuctionConfig::SEED_PREFIX,
            &u32::default().to_be_bytes()
        ],
        bump,
    )]
    auction_config: Account<'info, AuctionConfig>,

    /// CHECK: This account must not be the zero pubkey.
    /// TODO: do we prevent the owner from being the owner assistant?
    #[account(
        owner = Pubkey::default(),
        constraint = {
            owner_assistant.key() != Pubkey::default()
        } @ MatchingEngineError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = (
            fee_recipient.key() != Pubkey::default()
        ) @ MatchingEngineError::FeeRecipientZeroPubkey
    )]
    fee_recipient: AccountInfo<'info>,

    #[account(
        associated_token::mint = usdc,
        associated_token::authority = fee_recipient,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = usdc,
        associated_token::authority = custodian,
        address = crate::cctp_mint_recipient::id(),
    )]
    cctp_mint_recipient: Account<'info, token::TokenAccount>,

    usdc: Usdc<'info>,

    /// We use the program data to make sure this owner is the upgrade authority (the true owner,
    /// who deployed this program).
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable::id(),
        constraint = {
            program_data.upgrade_authority_address.is_some()
        } @ MatchingEngineError::ImmutableProgram
    )]
    program_data: Account<'info, ProgramData>,

    /// CHECK: This program PDA will be the upgrade authority for the Token Router program.
    #[account(address = common::constants::UPGRADE_MANAGER_AUTHORITY)]
    upgrade_manager_authority: AccountInfo<'info>,

    /// CHECK: This program must exist.
    #[account(
        executable,
        address = common::constants::UPGRADE_MANAGER_PROGRAM_ID,
    )]
    upgrade_manager_program: AccountInfo<'info>,

    bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

pub fn initialize(ctx: Context<Initialize>, auction_params: AuctionParameters) -> Result<()> {
    let owner: Pubkey = ctx.accounts.owner.key();
    let auction_config_id = 0;

    // We need to check that the upgrade authority is the owner passed into the account context.
    #[cfg(not(feature = "integration-test"))]
    {
        require_keys_eq!(
            ctx.accounts.owner.key(),
            ctx.accounts.program_data.upgrade_authority_address.unwrap(),
            MatchingEngineError::OwnerOnly
        );

        bpf_loader_upgradeable::set_upgrade_authority(
            CpiContext::new(
                ctx.accounts
                    .bpf_loader_upgradeable_program
                    .to_account_info(),
                bpf_loader_upgradeable::SetUpgradeAuthority {
                    program_data: ctx.accounts.program_data.to_account_info(),
                    current_authority: ctx.accounts.owner.to_account_info(),
                    new_authority: Some(ctx.accounts.upgrade_manager_authority.to_account_info()),
                },
            ),
            &crate::id(),
        )?;
    }

    crate::utils::auction::require_valid_parameters(&auction_params)?;

    ctx.accounts.custodian.set_inner(Custodian {
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_recipient_token: ctx.accounts.fee_recipient_token.key(),
        auction_config_id,
        next_proposal_id: Default::default(),
    });

    ctx.accounts.auction_config.set_inner(AuctionConfig {
        id: auction_config_id,
        parameters: auction_params,
    });

    // Done.
    Ok(())
}
