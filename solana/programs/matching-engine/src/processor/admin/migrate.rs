use crate::{error::MatchingEngineError, state::Custodian};
use anchor_lang::{prelude::*, system_program};

#[account]
#[derive(Debug, InitSpace)]
struct LegacyCustodian {
    /// Program's owner.
    pub owner: Pubkey,
    pub pending_owner: Option<Pubkey>,

    /// Program's assistant.
    pub owner_assistant: Pubkey,

    // Recipient of `SlowOrderResponse` relay fees.
    pub fee_recipient_token: Pubkey,

    pub auction_config_id: u32,

    pub next_proposal_id: u64,
}

#[derive(Accounts)]
pub struct Migrate<'info> {
    // admin: OwnerOnly<'info>,
    owner: Signer<'info>,

    /// CHECK: Custodian account.
    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump,
    )]
    custodian: AccountInfo<'info>,

    #[account(mut)]
    payer: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
    realloc_custodian(ctx)
}

fn realloc_custodian(ctx: Context<Migrate>) -> Result<()> {
    msg!("realloc_custodian");

    let custodian = {
        let mut acc_data: &[_] = &ctx.accounts.custodian.try_borrow_data()?;

        let LegacyCustodian {
            owner,
            pending_owner,
            owner_assistant,
            fee_recipient_token,
            auction_config_id,
            next_proposal_id,
        } = LegacyCustodian::try_deserialize_unchecked(&mut acc_data)?;

        require_keys_eq!(
            owner,
            ctx.accounts.owner.key(),
            MatchingEngineError::OwnerOnly
        );

        Custodian {
            owner,
            pending_owner,
            paused: false,
            paused_set_by: Default::default(),
            owner_assistant,
            fee_recipient_token,
            auction_config_id,
            next_proposal_id,
        }
    };

    {
        const NEW_LEN: usize = 8 + Custodian::INIT_SPACE;

        let lamports_diff = Rent::get()
            .unwrap()
            .minimum_balance(NEW_LEN)
            .saturating_sub(ctx.accounts.custodian.try_lamports()?);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.custodian.to_account_info(),
                },
            ),
            lamports_diff,
        )?;

        ctx.accounts.custodian.realloc(NEW_LEN, false)?;

        let acc_data: &mut [_] = &mut ctx.accounts.custodian.try_borrow_mut_data()?;
        let mut cursor = std::io::Cursor::new(acc_data);
        custodian.try_serialize(&mut cursor)?;
    }

    Ok(())
}
