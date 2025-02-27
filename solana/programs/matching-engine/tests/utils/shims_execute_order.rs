use anchor_lang::prelude::*;
use super::{constants::*, setup::Solver};
use wormhole_svm_shim::{post_message, verify_vaa};
use solana_sdk::{
    compute_budget::ComputeBudgetInstruction,
    hash::Hash,
    message::{v0::Message, VersionedMessage},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::{Transaction, VersionedTransaction},
};
use solana_program_test::ProgramTestContext;
use std::{rc::Rc, str::FromStr};
use std::cell::RefCell;
use wormhole_svm_definitions::{
    solana::Finality,
    find_emitter_sequence_address,
    find_shim_message_address,
};
use base64::Engine;
use matching_engine::{accounts::{CheckedCustodian, FastOrderPathShim, LiveRouterEndpoint, LiveRouterPath}, state::Auction};
use matching_engine::instruction::ExecuteFastOrderCctp as ExecuteFastOrderCctpIx;
use matching_engine::accounts::ExecuteFastOrderCctp as ExecuteFastOrderCctpAccounts;
use anchor_lang::InstructionData;
use solana_sdk::instruction::Instruction;
use wormhole_svm_definitions::borsh::GuardianSignatures;

