use anchor_lang::prelude::*;
use solana_program::{instruction::Instruction, sysvar::instructions::load_instruction_at_checked};

pub trait RequireValidInstructionsError {
    fn require_eq_this_program(actual_program_id: Pubkey) -> Result<()>;

    fn require_eq_upgrade_manager(actual_program_id: Pubkey) -> Result<()>;
}

pub fn require_valid_instructions<E>(instructions_sysvar: &AccountInfo) -> Result<()>
where
    E: RequireValidInstructionsError,
{
    // Check instruction to make sure this is executed top level as the first instruction.
    {
        let Instruction { program_id, .. } = load_instruction_at_checked(0, instructions_sysvar)?;
        E::require_eq_this_program(program_id)?;
    }

    // Check that the next instruction is the Upgrade Manager's.
    {
        let Instruction { program_id, .. } = load_instruction_at_checked(1, instructions_sysvar)?;
        E::require_eq_upgrade_manager(program_id)?;
    }

    // Done.
    Ok(())
}
