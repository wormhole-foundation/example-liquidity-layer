use crate::{error::MatchingEngineError, state::{Custodian, AuctionConfig}};
use crate::{constants::FEE_PRECISION_MAX, constants::UPGRADE_SEED_PREFIX};
use anchor_lang::prelude::*;
use solana_program::bpf_loader_upgradeable;


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

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = owner_assistant.key() != Pubkey::default() @ MatchingEngineError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = fee_recipient.key() != Pubkey::default() @ MatchingEngineError::FeeRecipientZeroPubkey
    )]
    fee_recipient: AccountInfo<'info>,

    /// CHECK: We need this upgrade authority to invoke the BPF Loader Upgradeable program to
    /// upgrade this program's executable. We verify this PDA address here out of convenience to get
    /// the PDA bump seed to invoke the upgrade.
    #[account(
        seeds = [UPGRADE_SEED_PREFIX],
        bump,
    )]
    upgrade_authority: AccountInfo<'info>,

    /// CHECK: BPF Loader Upgradeable program needs to modify this program's data to change the
    /// upgrade authority. We check this PDA address just in case there is another program that this
    /// deployer has deployed.
    ///
    /// NOTE: Set upgrade authority is scary because any public key can be used to set as the
    /// authority.
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf_loader_upgradeable_program,
    )]
    program_data: AccountInfo<'info>,

    /// CHECK: The account's pubkey must be the BPF Loader Upgradeable program's.
    #[account(address = bpf_loader_upgradeable::id())]
    bpf_loader_upgradeable_program: AccountInfo<'info>,

    system_program: Program<'info, System>,
}

#[access_control(check_constraints(&config))]
pub fn initialize(
    ctx: Context<Initialize>,
    config: AuctionConfig,
) -> Result<()> {
    let owner: Pubkey = ctx.accounts.owner.key();
    ctx.accounts.custodian.set_inner(Custodian {
        bump: ctx.bumps["custodian"],
        upgrade_authority_bump: ctx.bumps["upgrade_authority"],
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_recipient: ctx.accounts.fee_recipient.key(),
        auction_config: config
    });

    // Finally set the upgrade authority to this program's upgrade PDA.
    #[cfg(not(feature = "integration-test"))]
    {
        solana_program::program::invoke_signed(
            &bpf_loader_upgradeable::set_upgrade_authority_checked(
                &crate::ID,
                &ctx.accounts.owner.key(),
                &ctx.accounts.upgrade_authority.key(),
            ),
            &ctx.accounts.to_account_infos(),
            &[&[
                UPGRADE_SEED_PREFIX,
                &[ctx.accounts.custodian.upgrade_authority_bump],
            ]],
        )?;
    }

    // Done.
    Ok(())
}

fn check_constraints(config: &AuctionConfig) -> Result<()> {
    require!(config.auction_duration > 0, MatchingEngineError::InvalidAuctionDuration);
    require!(
        config.auction_grace_period > config.auction_duration,
        MatchingEngineError::InvalidAuctionGracePeriod
    );
    require!(
        config.user_penalty_reward_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::UserPenaltyTooLarge
    );
    require!(
        config.initial_penalty_bps <= FEE_PRECISION_MAX,
        MatchingEngineError::InitialPenaltyTooLarge
    );

    // Done.
    Ok(())
}
