import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram, ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { solana, getLocalDependencyAddress, env } from "../../helpers";
import { capitalize } from "../../helpers/utils";
import { circle } from "@wormhole-foundation/sdk-base";

solana.runOnSolana("update-auction-parameters", async (chain, signer, log) => {
    const matchingEngineId = getLocalDependencyAddress("matchingEngineProxy", chain) as ProgramId;
    const canonicalEnv = capitalize(env);
    if (canonicalEnv !== "Mainnet" && canonicalEnv !== "Testnet") {
        throw new Error(`Unsupported environment: ${env}  must be Mainnet or Testnet`);
    }

    const usdcMint = new PublicKey(circle.usdcContract(canonicalEnv, "Solana"));
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

    log('Matching Engine Program ID:', matchingEngineId.toString());

    log("Proposal to be closed", await matchingEngine.fetchProposal());

    if (solana.priorityMicrolamports === undefined || solana.priorityMicrolamports === 0) {
        log(`(!) PRIORITY_MICROLAMPORTS is undefined or zero,  your transaction may not land during congestion.`)
    }

    const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });
    const ownerOrAssistant = new PublicKey(await signer.getAddress());

    const closeProposalIx = await matchingEngine.closeProposalIx({
        ownerOrAssistant,
    });

    try {
        const closeTxSig = await solana.ledgerSignAndSend(connection, [closeProposalIx, priorityFee], []);
        console.log(`Close Proposal Transaction ID: ${closeTxSig}`);
    } catch (error) {
        console.error('Failed to close proposal:', error);
    }

});
