use crate::{error::TokenRouterError, state::Custodian};
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
    /// Sender Config account, which saves program data useful for other
    /// instructions, specifically for outbound transfers. Also saves the payer
    /// of the [`initialize`](crate::initialize) instruction as the program's
    /// owner.
    custodian: Account<'info, Custodian>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = owner_assistant.key() != Pubkey::default() @ TokenRouterError::AssistantZeroPubkey
    )]
    owner_assistant: AccountInfo<'info>,

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

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    ctx.accounts.custodian.set_inner(Custodian {
        bump: ctx.bumps["custodian"],
        paused: false,
        paused_set_by: owner,
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
    });

    #[cfg(not(feature = "integration-test"))]
    {
        // Make the program immutable.
        solana_program::program::invoke(
            &bpf_loader_upgradeable::set_upgrade_authority(
                &crate::ID,
                &ctx.accounts.owner.key(),
                None,
            ),
            &ctx.accounts.to_account_infos(),
        )?;
    }

    // Done.
    Ok(())
}
