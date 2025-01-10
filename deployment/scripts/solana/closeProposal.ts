import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { solana, getLocalDependencyAddress, env, getMatchingEngineAuctionParameters } from "../../helpers";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { circle } from "@wormhole-foundation/sdk-base";

solana.runOnSolana("update-auction-parameters", async (chain, signer, log) => {
  const matchingEngineId = getLocalDependencyAddress("matchingEngineProxy", chain) as ProgramId;

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  const canonicalEnv = capitalize(env);

  if (canonicalEnv !== "Mainnet" && canonicalEnv !== "Testnet") {
    throw new Error(`Unsupported environment: ${env}  must be Mainnet or Testnet`);
  }

  const usdcMint = new PublicKey(circle.usdcContract(canonicalEnv, "Solana"));
  const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
  const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

  log('Matching Engine Program ID:', matchingEngineId.toString());

  log("Proposal to be closed", await matchingEngine.fetchProposal());

  const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });
  const ownerOrAssistant = new PublicKey(await signer.getAddress());
  
  const closeProposalIx = await matchingEngine.closeProposalIx({
    ownerOrAssistant,
  });

  const closeTxSig = await solana.ledgerSignAndSend(connection, [closeProposalIx, priorityFee], []);
  console.log(`Close Proposal Transaction ID: ${closeTxSig}`);

});
