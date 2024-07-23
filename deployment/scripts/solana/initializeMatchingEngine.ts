import {
  AccountInfo,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { uint64ToBN } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import { AuctionParameters, MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { solana, LoggerFn, getChainConfig, getContractAddress } from "../../helpers";
import { MatchingEngineConfiguration } from "../../config/config-types";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { circle } from "@wormhole-foundation/sdk-base";

solana.runOnSolana("deploy-matching-engine", async (chain, signer, log) => {
    const config = await getChainConfig<MatchingEngineConfiguration>("matching-engine", chain.chainId);
    const matchingEngineId = getContractAddress("MatchingEngine", chain.chainId) as ProgramId;

    const env = "Mainnet";
    const usdcMint = new PublicKey(circle.usdcContract(env, "Solana"));
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

    await initialize(matchingEngine, signer, log, config, usdcMint);
});

async function initialize(matchingEngine: MatchingEngineProgram, signer: SolanaLedgerSigner, log: LoggerFn, config: MatchingEngineConfiguration, usdcMint: PublicKey) {
    const connection = matchingEngine.program.provider.connection;

    const custodian = matchingEngine.custodianAddress();
    log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct: null | AccountInfo<Buffer>) => acct != null);
    if (exists) {
        log("already initialized");
        return;
    }

    const signerPubkey = new PublicKey(await signer.getAddress());
    const auctionParams: AuctionParameters = {
        userPenaltyRewardBps: toIntegerNumber(config.userPenaltyRewardBps, "userPenaltyRewardBps"),
        initialPenaltyBps: toIntegerNumber(config.initialPenaltyBps, "initialPenaltyBps"),
        duration: toIntegerNumber(config.auctionDuration, "duration"),
        gracePeriod: toIntegerNumber(config.auctionGracePeriod, "gracePeriod"),
        penaltyPeriod: toIntegerNumber(config.auctionPenaltySlots, "penaltyPeriod"),
        minOfferDeltaBps: toIntegerNumber(config.minOfferDeltaBps, "minOfferDeltaBps"),
        securityDepositBase: uint64ToBN(BigInt(config.securityDepositBase)),
        securityDepositBps: toIntegerNumber(config.securityDepositBps, "securityDepositBps"),
    }
    const initializeIx = await matchingEngine.initializeIx(
        {
            owner: signerPubkey,
            ownerAssistant: new PublicKey(config.ownerAssistant),
            feeRecipient: new PublicKey(config.feeRecipient),
        },
        auctionParams
    );

    const splToken = await import("@solana/spl-token");
    const assocciatedTokenProgramId = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;
    const associatedToken = splToken.getAssociatedTokenAddressSync(usdcMint, signerPubkey, undefined, usdcMint, assocciatedTokenProgramId);
    const createAtaInstructions = [];
    createAtaInstructions.push(splToken.createAssociatedTokenAccountInstruction(signerPubkey, associatedToken, signerPubkey, usdcMint));
    createAtaInstructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }));

    const createAtaTxid = await solana.ledgerSignAndSend(connection, createAtaInstructions, []);
    log(`CreateAtaTxid ${createAtaTxid}`);

    const initializeTxid = await solana.ledgerSignAndSend(connection, [initializeIx], []);
    log(`InitializeTxid ${initializeTxid}`);
}

function toIntegerNumber(text: string, name: string): number {
    const res = Number(text);
    if (!Number.isSafeInteger(res)) {
        throw new Error(`${name} is not a safe integer. Received ${text}`)
    }
    return res;
}