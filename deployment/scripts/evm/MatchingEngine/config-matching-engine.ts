import { MatchingEngine } from "../../../contract-bindings";
import { runOnEvmsSequentially, ChainInfo, LoggerFn, getContractInstance, getContractAddress } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";
import confirm from '@inquirer/confirm';

runOnEvmsSequentially("config-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const matchingEngineAddress = await getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEgine = (await getContractInstance("MatchingEngine", matchingEngineAddress, chain)) as MatchingEngine;
  const diff = await getConfigurationDifferences(chain);

  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);

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

    await matchingEgine.updateFeeRecipient(feeRecipient.offChain);
    log(`Fee recipient updated to ${feeRecipient.offChain}`);
  }

  // CCTP allowance
  if (cctpAllowance.onChain.toString() !== cctpAllowance.offChain.toString()) {
    await matchingEgine.setCctpAllowance(cctpAllowance.offChain);
    log(`CCTP allowance updated to ${cctpAllowance.offChain}`);
  }

  // Router endpoints
  for (const { chainId, router, mintRecipient, circleDomain } of routerEndpoints) {
    const offChainEndpoint = {
      router: router.offChain,
      mintRecipient: mintRecipient.offChain
    };
    
    // Add new router endpoint if all values are zero
    if (Number(router?.onChain) === 0 && Number(mintRecipient?.onChain) === 0 && Number(circleDomain?.onChain) === 0) {
      if (chainId === 0) 
        throw new Error('Invalid chainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for chainId ${chainId}`);

      await matchingEgine.addRouterEndpoint(chainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint added for chainId ${chainId}`);
      continue;
    }

    // Disable router endpoint, must be the three values zero
    if (Number(router?.offChain) === 0 && Number(mintRecipient?.offChain) === 0 && Number(circleDomain?.offChain) === 0) {
      await matchingEgine.disableRouterEndpoint(chainId);
      log(`Router endpoint disabled for chainId ${chainId}`);
      continue;
    }

    // Update router endpoint
    if (
      router?.onChain.toString() !== router?.offChain.toString() || 
      mintRecipient?.onChain.toString() !== mintRecipient?.offChain.toString() || 
      circleDomain?.onChain.toString() !== circleDomain?.offChain.toString()
    ) {      
      if (chainId === 0) 
        throw new Error('Invalid chainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for chainId ${chainId}`);

      await matchingEgine.updateRouterEndpoint(chainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint updated for chainId ${chainId}`);
      continue;
    }
  }
});