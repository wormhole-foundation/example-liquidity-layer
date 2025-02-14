use solana_sdk::{
    account::{AccountSharedData, ReadableAccount, WritableAccount},
    program_pack::Pack,
    signer::Signer,
    pubkey::Pubkey,
};
use solana_program_test::ProgramTestContext;
use solana_cli_output::CliAccount;
use anchor_spl::token::spl_token;
use spl_token::state::Mint;

use std::{cell::RefCell, fs::File, io::Read, path::PathBuf, rc::Rc, str::FromStr};

#[derive(Clone)]
pub struct MintFixture {
    pub test_ctx: Rc<RefCell<ProgramTestContext>>,
    pub key: Pubkey,
    pub mint: spl_token::state::Mint,
    pub token_program: Pubkey,
}

impl MintFixture {

    /// Creates a new MintFixture from a file
    ///
    /// # Arguments
    ///
    /// * `ctx` - The test context
    /// * `relative_path` - The relative path to the mint file
    ///
    /// # Returns
    /// 
    /// A new MintFixture
    pub fn new_from_file(
        ctx: &Rc<RefCell<ProgramTestContext>>,
        relative_path: &str,
    ) -> MintFixture {
        let ctx_ref = Rc::clone(ctx);

        let (address, account_info) = {
            let mut ctx = ctx.borrow_mut();

            // load cargo workspace path from env
            let mut path = PathBuf::from_str(env!("CARGO_MANIFEST_DIR")).unwrap();
            path.push(relative_path);
            let mut file = File::open(&path).unwrap();
            let mut account_info_raw = String::new();
            file.read_to_string(&mut account_info_raw).unwrap();

            let account: CliAccount = serde_json::from_str(&account_info_raw).unwrap();
            let address = Pubkey::from_str(&account.keyed_account.pubkey).unwrap();
            let mut account_info: AccountSharedData =
                account.keyed_account.account.decode().unwrap();

            let mut mint =
                spl_token::state::Mint::unpack(&account_info.data()[..Mint::LEN]).unwrap();
            let payer = ctx.payer.pubkey();
            mint.mint_authority.replace(payer);

            let mint_bytes = &mut [0; Mint::LEN];
            spl_token::state::Mint::pack(mint, mint_bytes).unwrap();

            account_info.data_as_mut_slice()[..Mint::LEN].copy_from_slice(mint_bytes);

            ctx.set_account(&address, &account_info);

            (address, account_info)
        };
        let mint = spl_token::state::Mint::unpack(&account_info.data()[..Mint::LEN]).unwrap();

        MintFixture {
            test_ctx: ctx_ref,
            key: address,
            mint,
            token_program: account_info.owner().to_owned(),
        }
    }
}