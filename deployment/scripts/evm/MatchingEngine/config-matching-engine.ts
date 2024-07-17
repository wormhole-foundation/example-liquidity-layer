import { MatchingEngine } from "../../../contract-bindings";
import { runOnEvmsSequentially, ChainInfo, LoggerFn, getContractInstance, getContractAddress } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";
import confirm from '@inquirer/confirm';
import { inspect } from "util";
import chalk from "chalk";

runOnEvmsSequentially("config-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const matchingEngineAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngine = (await getContractInstance("MatchingEngine", matchingEngineAddress, chain)) as MatchingEngine;
  const diff = await getConfigurationDifferences(chain);

  console.log(inspect(diff, { depth: null, colors: true }));

  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log, ["new", "update"]);

  const deployConfig: boolean = await confirm({ message: 'Continue?', default: false });
  if (!deployConfig){
    log(`Configuration deployment aborted on chain ${chain.chainId}`);
    return;
  }

  const { feeRecipient, cctpAllowance, routerEndpoints } = diff;

  // Fee recipient
  if (feeRecipient.onChain !== feeRecipient.offChain) {
    if (Number(feeRecipient.offChain) === 0)
      throw new Error('Invalid fee recipient address');

    await matchingEngine.updateFeeRecipient(feeRecipient.offChain);
    log(`Fee recipient updated to ${feeRecipient.offChain}`);
  }

  // CCTP allowance
  if (cctpAllowance.onChain.toString() !== cctpAllowance.offChain.toString()) {
    await matchingEngine.setCctpAllowance(cctpAllowance.offChain);
    log(`CCTP allowance updated to ${cctpAllowance.offChain}`);
  }

  // Router endpoints
  for (const { wormholeChainId, router, mintRecipient, circleDomain } of routerEndpoints) {
    const offChainEndpoint = {
      router: router.offChain,
      mintRecipient: mintRecipient.offChain
    };
    
    // Add new router endpoint if all values are zero
    if (Number(router?.onChain) === 0 && Number(mintRecipient?.onChain) === 0 && Number(circleDomain?.onChain) === 0) {
      if (wormholeChainId === 0) 
        throw new Error('Invalid wormholeChainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for wormholeChainId ${wormholeChainId}`);

      await matchingEngine.addRouterEndpoint(wormholeChainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint added for wormholeChainId ${wormholeChainId}`);
      continue;
    }

    // Update router endpoint
    if (
      router?.onChain.toString() !== offChainEndpoint.router.toString() || 
      mintRecipient?.onChain.toString() !== offChainEndpoint.mintRecipient.toString() || 
      circleDomain?.onChain.toString() !== circleDomain?.offChain.toString()
    ) {   

      if (Number(router?.offChain) === 0 && Number(mintRecipient?.offChain) === 0 && Number(circleDomain?.offChain) === 0) {
        log(`Router endpoint already disabled for wormholeChainId ${wormholeChainId}.`);
        continue;
      }

      if (wormholeChainId === 0) 
        throw new Error('Invalid wormholeChainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for wormholeChainId ${wormholeChainId}`);

      await matchingEngine.updateRouterEndpoint(wormholeChainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint updated for wormholeChainId ${wormholeChainId}`);
      continue;
    }
  }
});