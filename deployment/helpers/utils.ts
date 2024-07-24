import chalk from 'chalk';
import { ChainInfo, LoggerFn, ValueDiff } from '.';
import { UniversalAddress } from '@wormhole-foundation/sdk-definitions';

export const someoneIsDifferent = (values: ValueDiff[]) => values.some((value) => value.onChain.toString() !== value.offChain.toString() && Number(value.onChain) !== Number(value.offChain));

export function logComparison(name: string, diffValues: any, log: LoggerFn) {

  // If the values are the same, do nothing
  if (diffValues.onChain.toString() === diffValues.offChain.toString() || Number(diffValues.onChain) === Number(diffValues.offChain))
    return;

  // If the on chain value is not present or it is zero value, log it as an addition
  if (!diffValues.onChain || Number(diffValues.onChain) === 0)
    log(chalk.green(`+ ${name}: ${diffValues.offChain}`));

  // If the off chain value is not present or it is zero value, log it as a removal
  else if (!diffValues.offChain || Number(diffValues.offChain) === 0)
    log(chalk.red(`- ${name}: ${diffValues.onChain}`));

  // If both values are present and they are different, log it as a change
  else 
    log(chalk.yellow(`~ ${name}: `) + chalk.red(`${diffValues.onChain}`) + ' -> ' + chalk.green(`${diffValues.offChain}`));
}

// Assuming that we'll only have two types of addresses: Ethereum and Solana
export function getAddressType(address: string): 'hex' | 'base58' {
  const ETHEREUM_ADDRESS_LENGTH = 40;
  const addressLength = address.length - (address.startsWith("0x") ? 2 : 0);

  if (address.length < ETHEREUM_ADDRESS_LENGTH)
    throw new Error(`Invalid address length: ${address}`);

  return addressLength === ETHEREUM_ADDRESS_LENGTH ? 'hex' : 'base58';
}

export function flattenObject(obj: Record<string, any>, parentKey = '', result: Record<string, any> = {}) {
  for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
          let newKey = parentKey ? `${parentKey}-${key}` : key;

          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
              flattenObject(obj[key], newKey, result);
          } else {
              result[newKey] = obj[key];
          }
      }
  }
  return result;
}

export function getVerifyCommand({
  chain,
  contractName,
  contractPath,
  contractAddress,
  constructorSignature,
  constructorArgs,
  verifier,
  verifierUrl,
  apiKey
}: {  
  chain: ChainInfo,
  contractName: string,
  contractPath: string,
  contractAddress: string,
  constructorSignature: string,
  constructorArgs: any[],
  verifier: string,
  verifierUrl?: string,
  apiKey?: string
}): string {
  if (chain.externalId === undefined)
    throw new Error(`Chain ${chain.chainId} does not have an external ID`);

  if (verifier === "blockscout" && verifierUrl === undefined)
    throw new Error(`Verifier URL is required for Blockscout verifier`);

  let command = `
    forge verify-contract ${contractAddress} ${contractPath}:${contractName} \
    --verifier ${verifier} \
    ${ verifier === "blockscout" ? `--verifier-url ${verifierUrl}` : ''} \
    --watch --constructor-args $(cast abi-encode "${constructorSignature}" "${constructorArgs.join('" "')}") \
    --chain-id ${chain.externalId} \
    ${ apiKey === undefined || apiKey === "" ? '' : `--etherscan-api-key ${apiKey}` }
  `;

  return command;
}