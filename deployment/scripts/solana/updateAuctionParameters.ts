import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram, ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { env, getLocalDependencyAddress, getMatchingEngineAuctionParameters, solana } from "../../helpers";
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
    log('Current Matching Engine Auction parameters:', await matchingEngine.fetchAuctionParameters());
    log('\nTo-be-proposed Matching Engine Auction parameters:', getMatchingEngineAuctionParameters(chain));

    if (solana.priorityMicrolamports === undefined || solana.priorityMicrolamports === 0) {
        log(`(!) PRIORITY_MICROLAMPORTS is undefined or zero, your transaction may not land during congestion.`)
    }

    const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: solana.priorityMicrolamports });

    const ownerOrAssistant = new PublicKey(await signer.getAddress());
    const updateIx = await matchingEngine.updateAuctionParametersIx({
        owner: ownerOrAssistant,
    });
    try {
        const updateTxSig = await solana.ledgerSignAndSend(connection, [updateIx, priorityFee], []);
        log(`Update Transaction ID: ${updateTxSig}`);
    } catch (error) {
        console.error('Failed to send transaction:', error);
    }
});
