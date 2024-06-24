import chalk from 'chalk';
import { ETHEREUM_ADDRESS_LENGTH, LoggerFn, ValueDiff } from '.';
import { ChainId } from '@certusone/wormhole-sdk';
import { RouterEndpointConfig } from '../config/config-types';
import { ethers } from 'ethers';
import bs58 from 'bs58';

export const someoneIsDifferent = (values: ValueDiff[]) => values.some((value) => value.onChain.toString() !== value.offChain.toString());

export function logComparision(name: string, diffValues: any, log: LoggerFn) {

  // If the values are the same, do nothing
  if (diffValues.onChain.toString() === diffValues.offChain.toString())
    return;

  // If the on chain value is not present or it is zero value, log it as an addition
  if (!diffValues.onChain || Number(diffValues.onChain) === 0) {
    log(chalk.green(`+ ${name}: ${diffValues.offChain}`));
  }

  // If the off chain value is not present or it is zero value, log it as a removal
  else if (!diffValues.offChain || Number(diffValues.offChain) === 0) {
    log(chalk.red(`- ${name}: ${diffValues.onChain}`));
  }

  // If both values are present and they are different, log it as a change
  else {
    log(chalk.yellow(`~ ${name}: `) + chalk.red(`${diffValues.onChain}`) + ' -> ' + chalk.green(`${diffValues.offChain}`));
  }
}

export function getAddressAsBytes32(address: string): string {
  const addressLength = address.length - (address.startsWith("0x") ? 2 : 0);

  // Solana address
  if (addressLength > ETHEREUM_ADDRESS_LENGTH) { 
    const bytes = bs58.decode(address);
    address = "0x" + Buffer.from(bytes).toString('hex');
  } 
  // Ethereum address
  else { 
    address = ethers.utils.defaultAbiCoder.encode(["address"], [address]);
  }

  return address;
}

// Router endpoint helpers

export function getRouterEndpointDifferences(onChainRouterEndpoints: RouterEndpointConfig[], offChainRouterEndpoints: RouterEndpointConfig[]) {
  const routerEndpointsDifferences = [];
  let onChainIndex = 0;
  let offChainIndex = 0; 
  
  onChainRouterEndpoints = onChainRouterEndpoints.sort((a, b) => a.chainId - b.chainId);
  offChainRouterEndpoints = offChainRouterEndpoints.sort((a, b) => a.chainId - b.chainId);
  
  while (true) {
    const onChainEndpoint = onChainRouterEndpoints[onChainIndex];
    const offChainEndpoint = offChainRouterEndpoints[offChainIndex];

    // If we've reached the end of both arrays, we're done
    if (!onChainEndpoint && !offChainEndpoint) {
      break;
    }

    // If we've reached the end of offChainEndpoints, add the remaining onChainEndpoints
    // or if the onChainEndpoint is less than the offChainEndpoint, add the onChainEndpoint
    if (!offChainEndpoint || onChainEndpoint?.chainId < offChainEndpoint?.chainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(onChainEndpoint.chainId, onChainEndpoint, {})
      );
      onChainIndex++;
      continue;
    } 

    // If we've reached the end of onChainEndpoints, add the remaining offChainEndpoints
    // or if the offChainEndpoint is less than the onChainEndpoint, add the offChainEndpoint
    if (!onChainEndpoint || onChainEndpoint?.chainId > offChainEndpoint?.chainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(offChainEndpoint.chainId, {}, offChainEndpoint)
      );
      offChainIndex++;
      continue;
    } 

    routerEndpointsDifferences.push(
      routerEndpointConfig(onChainEndpoint.chainId, onChainEndpoint, offChainEndpoint)
    );

    onChainIndex++;
    offChainIndex++;
  }

  return routerEndpointsDifferences;
}

const routerEndpointConfig = (chainId: ChainId,  onChain: Partial<RouterEndpointConfig>, offChain: Partial<RouterEndpointConfig>) => ({
  chainId,
  router: {
    onChain: onChain?.endpoint?.router,
    offChain: offChain?.endpoint?.router ? getAddressAsBytes32(offChain?.endpoint?.router as string) : undefined
  },
  mintRecipient: {
    onChain: onChain?.endpoint?.mintRecipient,
    offChain: offChain?.endpoint?.mintRecipient ? getAddressAsBytes32(offChain?.endpoint?.mintRecipient as string) : undefined
  },
  circleDomain: {
    onChain: onChain?.circleDomain,
    offChain: offChain?.circleDomain
  }
});