import { MatchingEngine } from "../../../contract-bindings";
import { runOnEvmsSequentially, ChainInfo, LoggerFn, getContractInstance, getContractAddress, logComparision } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences } from "./utils";
import confirm from '@inquirer/confirm';
import chalk from "chalk";

runOnEvmsSequentially("update-owner-assistant-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const matchingEngineAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const matchingEngine = (await getContractInstance("MatchingEngine", matchingEngineAddress, chain)) as MatchingEngine;
  const diff = await getConfigurationDifferences(chain);

  
  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  logComparision('OwnerAssistant', diff.ownerAssistant, log);

  if (diff.ownerAssistant.onChain === diff.ownerAssistant.offChain) {
    log(`No differences found on chain ${chain.chainId}`);
    return;
  }

  const updateOwnerAssistant: boolean = await confirm({ message: 'Continue?', default: false });
  if (!updateOwnerAssistant){
    log(`OwnerAssistant update aborted on chain ${chain.chainId}`);
    return;
  }

  const ownerAddress = await matchingEngine.getOwner();
  const signerAddress = await signer.getAddress();
  if (signerAddress !== ownerAddress) {
    throw new Error(`Signer address ${signerAddress} is not the owner of MatchingEngine on chain ${chain.chainId}`);
  }

  log(`Updating OwnerAssistant on chain ${chain.chainId}`);
  await matchingEngine.updateOwnerAssistant(diff.ownerAssistant.offChain);
});