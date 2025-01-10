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

  if (solana.priorityMicrolamports === undefined || solana.priorityMicrolamports === 0) {
     log(`(!) PRIORITY_MICROLAMPORTS is undefined or zero,  your transaction may either be rejected during high activity`)
  }

  const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });
  const ownerOrAssistant = new PublicKey(await signer.getAddress());

  const proposeIx = await matchingEngine.proposeAuctionParametersIx({
    ownerOrAssistant,
  }, getMatchingEngineAuctionParameters(chain));

  const proposeTxSig = await solana.ledgerSignAndSend(connection, [proposeIx, priorityFee], []);

  if (proposeTxSig) {
    log(`Propose Transaction ID: ${proposeTxSig}.`)

    const proposal = await matchingEngine.fetchProposal();
    log(`The proposal has been published at slot ${proposal.slotProposedAt.toNumber()}.`);
    log(`It has an enact delay of ${proposal.slotEnactDelay.toNumber()} slots.  You must wait up to slot ${proposal.slotProposedAt.add(proposal.slotEnactDelay).toNumber()}` + 
        `\nto submit the changes using the updateAuctionParameters script`)
  }
});
