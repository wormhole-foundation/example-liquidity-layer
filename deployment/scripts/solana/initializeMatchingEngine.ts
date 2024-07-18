import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { uint64ToBN } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import { AuctionParameters, MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { LoggerFn, connectionCommitmentLevel, getChainConfig, getContractAddress, ledgerSignAndSend, runOnSolana } from "../../helpers";
import { MatchingEngineConfiguration } from "../../config/config-types";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { circle } from "@wormhole-foundation/sdk-base";


const AUCTION_PARAMS: AuctionParameters = {
    userPenaltyRewardBps: 400000, // 40%
    initialPenaltyBps: 250000, // 25%
    duration: 5, // slots
    gracePeriod: 10, // slots
    penaltyPeriod: 20, // slots
    minOfferDeltaBps: 50000, // 5%
    securityDepositBase: uint64ToBN(1000000n), // 1 USDC
    securityDepositBps: 5000, // 0.5%
};

runOnSolana("deploy-matching-engine", async (chain, signer, log) => {
    const config = await getChainConfig<MatchingEngineConfiguration>("matching-engine", chain.chainId);
    const matchingEngineId = getContractAddress("MatchingEngine", chain.chainId) as ProgramId;

    const env = "Mainnet";
    const usdcMint = new PublicKey(circle.usdcContract(env, "Solana"));
    const connection = new Connection(chain.rpc, connectionCommitmentLevel);
    const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

    await initialize(matchingEngine, signer, log, config, usdcMint);
});

async function initialize(matchingEngine: MatchingEngineProgram, signer: SolanaLedgerSigner, log: LoggerFn, config: MatchingEngineConfiguration, usdcMint: PublicKey) {
    const connection = matchingEngine.program.provider.connection;

    const custodian = matchingEngine.custodianAddress();
    log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        log("already initialized");
        return;
    }

    const signerPubkey = new PublicKey(await signer.getAddress());
    const initializeIx = await matchingEngine.initializeIx(
        {
            owner: signerPubkey,
            ownerAssistant: signerPubkey,
            feeRecipient: signerPubkey,
        },
        AUCTION_PARAMS,
    );

    const splToken = await import("@solana/spl-token");
    const assocciatedTokenProgramId = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;
    const associatedToken = splToken.getAssociatedTokenAddressSync(usdcMint, signerPubkey, undefined, usdcMint, assocciatedTokenProgramId);
    const createAtaInstructions = [];
    createAtaInstructions.push(splToken.createAssociatedTokenAccountInstruction(signerPubkey, associatedToken, signerPubkey, usdcMint));
    createAtaInstructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }));

    const createAtaTxid = await ledgerSignAndSend(connection, createAtaInstructions, []);
    log(`CreateAtaTxid ${createAtaTxid}`);

    const initializeTxid = await ledgerSignAndSend(connection, [initializeIx], []);
    log(`InitializeTxid ${initializeTxid}`);
}

