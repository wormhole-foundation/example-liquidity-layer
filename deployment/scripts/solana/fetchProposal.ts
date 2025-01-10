import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { solana, getLocalDependencyAddress, env, capitalize } from "../../helpers";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { circle } from "@wormhole-foundation/sdk-base";

solana.runOnSolana("fetch-proposal", async (chain, signer, log) => {
    const matchingEngineId = getLocalDependencyAddress("matchingEngineProxy", chain) as ProgramId;

    const canonicalEnv = capitalize(env);

    if (canonicalEnv !== "Mainnet" && canonicalEnv !== "Testnet") {
        throw new Error(`Unsupported environment: ${env}  must be Mainnet or Testnet.`);
    }

    const usdcMint = new PublicKey(circle.usdcContract(canonicalEnv, "Solana"));
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

    log('Matching Engine Program ID:', matchingEngineId.toString());

    const proposal = await matchingEngine.fetchProposal();
    log('Proposal:', proposal);

    if (proposal.slotEnactedAt !== null) {
        log(`Proposal has already been enacted at slot ${proposal.slotEnactedAt.toNumber()}`);
    } else {
        log('Proposal has not been enacted yet. Update must be submitted after slot ' + proposal.slotEnactDelay.toNumber());
    }
});
