import { runOnEvms, ChainInfo, LoggerFn, zeroValues } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences } from "./utils";
import chalk from 'chalk';

runOnEvms("get-config-diff-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const diff = await getConfigurationDifferences(chain);

  log(`MatchingEngine configuration differences on chain ${chain.chainId}:`);
  walkThrough(diff, log);
});

function walkThrough(differences: Record<string, any>, log: LoggerFn) {
  for (const [key, value] of Object.entries(differences)) {

    // If the value is an array, walk through each item
    if (Array.isArray(value)) {
      for (const item of value) {
        walkThrough(item, log);
      }
      continue;
    }

    // If the value is an object, walk through its properties
    if (!value.onChain && !value.offChain) {
      log(`${key}: `);
      walkThrough(value, log);
      continue;
    }

    logComparision(key, value, log);
  }
}


function logComparision(name: string, diffValues: any, log: LoggerFn) {
  // If the on chain value is not present or it is zero value, log it as an addition
  if (!diffValues.onChain || zeroValues.includes(diffValues.onChain)) {
    log(chalk.green(`+ ${name}: ${diffValues.offChain}`));
  }

  // If the off chain value is not present or it is zero value, log it as a removal
  else if (!diffValues.offChain || zeroValues.includes(diffValues.offChain)) {
    log(chalk.red(`- ${name}: ${diffValues.onChain}`));
  }

  // If both values are present and they are different, log it as a change
  else if (diffValues.onChain && diffValues.offChain) {
    log(chalk.yellow(`~ ${name}: `) + chalk.red(`${diffValues.onChain}`) + ' -> ' + chalk.green(`${diffValues.offChain}`));
  }
}
