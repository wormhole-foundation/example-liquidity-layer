import { MatchingEngine } from "../../../contract-bindings";
import { runOnEvmsSequentially, ChainInfo, LoggerFn, getContractInstance, getContractAddress } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logRoutersDiff } from "./utils";
import confirm from '@inquirer/confirm';
import chalk from "chalk";

runOnEvmsSequentially("disable-router-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const matchingEngineAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngine = (await getContractInstance("MatchingEngine", matchingEngineAddress, chain)) as MatchingEngine;
  const diff = await getConfigurationDifferences(chain);

  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logRoutersDiff(diff, log, ["delete"]);

  const deployConfig: boolean = await confirm({ message: 'Continue?', default: false });
  if (!deployConfig){
    log(`Configuration deployment aborted on chain ${chain.chainId}`);
    return;
  }

  const { routerEndpoints } = diff;

  // Router endpoints
  for (const { wormholeChainId, router, mintRecipient, circleDomain } of routerEndpoints) {

    // Disable router endpoint, must be the three values zero
    if (Number(router?.offChain) === 0 && Number(mintRecipient?.offChain) === 0 && Number(circleDomain?.offChain) === 0) {
      await matchingEngine.disableRouterEndpoint(wormholeChainId);
      log(`Router endpoint disabled for wormholeChainId ${wormholeChainId}`);
    }
  }
});