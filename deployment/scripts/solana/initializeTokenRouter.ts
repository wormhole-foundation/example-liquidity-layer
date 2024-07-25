import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { solana, LoggerFn, getChainConfig, getContractAddress } from "../../helpers";
import { TokenRouterConfiguration } from "../../config/config-types";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { circle } from "@wormhole-foundation/sdk-base";
import { TokenRouterProgram } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { ledgerSignAndSend } from "../../helpers/solana";

solana.runOnSolana("deploy-token-router", async (chain, signer, log) => {
    const config = await getChainConfig<TokenRouterConfiguration>("token-router", chain.chainId);
    const tokenRouterId = getContractAddress("TokenRouterProgram", chain.chainId) as ProgramId;

    const env = "Mainnet";
    const usdcMint = new PublicKey(circle.usdcContract(env, "Solana"));
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const tokenRouter = new TokenRouterProgram(connection, tokenRouterId, usdcMint);

    await initialize(tokenRouter, signer, log, config);
});

async function initialize(tokenRouter: TokenRouterProgram, signer: SolanaLedgerSigner, log: LoggerFn, config: TokenRouterConfiguration) {
    const connection = tokenRouter.program.provider.connection;

    const custodian = tokenRouter.custodianAddress();
    log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        log("already initialized");
        return;
    }

    const signerPubkey = new PublicKey(await signer.getAddress());
    const initializeIx = await tokenRouter.initializeIx({
        owner: signerPubkey,
        ownerAssistant: new PublicKey(config.ownerAssistant),
    });
    const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });

    const txSig = await ledgerSignAndSend(connection, [initializeIx, priorityFee], []);
    log("intialize", txSig);
}