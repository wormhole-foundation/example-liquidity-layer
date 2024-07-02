import chalk from 'chalk';
import { LoggerFn, ValueDiff, getEnv } from '.';
import { ChainId } from "@wormhole-foundation/sdk-base";
import { RouterEndpointConfig } from '../config/config-types';
import { UniversalAddress } from '@wormhole-foundation/sdk-definitions';

export const someoneIsDifferent = (values: ValueDiff[]) => values.some((value) => value.onChain.toString() !== value.offChain.toString() && Number(value.onChain) !== Number(value.offChain));

export function logComparision(name: string, diffValues: any, log: LoggerFn) {

  // If the values are the same, do nothing
  if (diffValues.onChain.toString() === diffValues.offChain.toString() || Number(diffValues.onChain) === Number(diffValues.offChain))
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

// Assuming that we'll only have two types of addresses: Ethereum and Solana
export function getAddressType(address: string): 'hex' | 'base58' {
  const ETHEREUM_ADDRESS_LENGTH = 40;
  const addressLength = address.length - (address.startsWith("0x") ? 2 : 0);

  // TODO: check lenght of solana addresses
  if (address.length < ETHEREUM_ADDRESS_LENGTH)
    throw new Error(`Invalid address length: ${address}`);

  return addressLength === ETHEREUM_ADDRESS_LENGTH ? 'hex' : 'base58';
}

// Router endpoint helpers

export function getRouterEndpointDifferences(onChainRouterEndpoints: RouterEndpointConfig[], offChainRouterEndpoints: RouterEndpointConfig[]) {
  const routerEndpointsDifferences = [];
  let onChainIndex = 0;
  let offChainIndex = 0; 
  
  onChainRouterEndpoints = onChainRouterEndpoints.sort((a, b) => a.wormholeChainId - b.wormholeChainId);
  offChainRouterEndpoints = offChainRouterEndpoints.sort((a, b) => a.wormholeChainId - b.wormholeChainId);
  
  while (true) {
    const onChainEndpoint = onChainRouterEndpoints[onChainIndex];
    const offChainEndpoint = offChainRouterEndpoints[offChainIndex];

    // If we've reached the end of both arrays, we're done
    if (!onChainEndpoint && !offChainEndpoint) {
      break;
    }

    // If we've reached the end of offChainEndpoints, add the remaining onChainEndpoints
    // or if the onChainEndpoint is less than the offChainEndpoint, add the onChainEndpoint
    if (!offChainEndpoint || onChainEndpoint?.wormholeChainId < offChainEndpoint?.wormholeChainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(onChainEndpoint.wormholeChainId, onChainEndpoint, {})
      );
      onChainIndex++;
      continue;
    } 

    // If we've reached the end of onChainEndpoints, add the remaining offChainEndpoints
    // or if the offChainEndpoint is less than the onChainEndpoint, add the offChainEndpoint
    if (!onChainEndpoint || onChainEndpoint?.wormholeChainId > offChainEndpoint?.wormholeChainId) {
      routerEndpointsDifferences.push(
        routerEndpointConfig(offChainEndpoint.wormholeChainId, {}, offChainEndpoint)
      );
      offChainIndex++;
      continue;
    } 

    routerEndpointsDifferences.push(
      routerEndpointConfig(onChainEndpoint.wormholeChainId, onChainEndpoint, offChainEndpoint)
    );

    onChainIndex++;
    offChainIndex++;
  }

  return routerEndpointsDifferences;
}

const routerEndpointConfig = (wormholeChainId: ChainId,  onChain: Partial<RouterEndpointConfig>, offChain: Partial<RouterEndpointConfig>) => ({
  wormholeChainId,
  router: {
    onChain: onChain?.endpoint?.router,
    offChain: offChain?.endpoint?.router
  },
  mintRecipient: {
    onChain: onChain?.endpoint?.mintRecipient,
    offChain: offChain?.endpoint?.mintRecipient 
  },
  circleDomain: {
    onChain: onChain?.circleDomain,
    offChain: offChain?.circleDomain
  }
});

export function getFormattedEndpoint(router: string, mintRecipient: string) {
  const routerAddresType = getAddressType(router);
  const mintRecipientAddressType = getAddressType(mintRecipient);

  return {
    router: (new UniversalAddress(router, routerAddresType)).toString(),
    mintRecipient: (new UniversalAddress(mintRecipient, mintRecipientAddressType)).toString()
  };
}

/// Verify bytecode helper

export function getVerifyCommand(
  contractName: string,
  contractPath: string,
  contractAddress: string,
  constructorSignature: string,
  constructorArgs: any[],
  EvmChainId: number
): string {
  const ETHERSCAN_API_KEY = getEnv("ETHERSCAN_API_KEY");
  return `
    forge verify-contract ${contractAddress} ${contractPath}:${contractName} \
    --watch --constructor-args $(cast abi-encode "${constructorSignature}" "${constructorArgs.join('" "')}") \
    --chain-id ${EvmChainId} \
    --etherscan-api-key ${ETHERSCAN_API_KEY} \
  `;
}