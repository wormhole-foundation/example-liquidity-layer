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
  log('Current Matching Engine Auction parameters:', await matchingEngine.fetchAuctionParameters());
  log('\nTo-be-proposed Matching Engine Auction parameters:', getMatchingEngineAuctionParameters(chain));

  const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });
  const ownerOrAssistant = new PublicKey(await signer.getAddress());
  
  const closeProposalIx = await matchingEngine.closeProposalIx({
    ownerOrAssistant,
  });

  const closeTxSig = await solana.ledgerSignAndSend(connection, [closeProposalIx, priorityFee], []);

  const proposeInstructions = [];
  const proposeIx = await matchingEngine.proposeAuctionParametersIx({
    ownerOrAssistant,
  }, getMatchingEngineAuctionParameters(chain));

  console.log(`Close Proposal Transaction ID: ${closeTxSig}`);

  // await connection.confirmTransaction(proposeTxSig, 'confirmed');

  // const updateInstructions = [];
  // const updateIx = await matchingEngine.updateAuctionParametersIx({
  //   owner: ownerOrAssistant,
  // });
  // updateInstructions.push(updateIx, priorityFee);
  // const updateTxSig = await solana.ledgerSignAndSend(connection, updateInstructions, []);

  // await connection.confirmTransaction(updateTxSig, 'confirmed');

  // console.log(`Update Transaction ID: ${updateTxSig}, wait for confirmation...`);
});
