import { ethers } from "ethers";
import { runOnEvms, ChainInfo, LoggerFn, writeDeployedContract } from "../../../helpers";
import { MatchingEngineConfiguration } from "../../../config/config-types";

import { ERC1967Proxy__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { deployImplementation, getMachingEngineConfiguration } from "./utils";

runOnEvms("deploy-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const config = await getMachingEngineConfiguration(chain);
  const implementation = await deployImplementation(signer, config, log);
  const proxy = await deployProxy(signer, config, implementation, log);
});

async function deployProxy(signer: ethers.Signer, config: MatchingEngineConfiguration, implementation: ethers.Contract, log: LoggerFn) {
  const factory = new ERC1967Proxy__factory(signer);
  const abi = ["function initialize(bytes)"];
  const iface = new ethers.utils.Interface(abi);
  const data = [config.ownerAssistant, config.feeRecipient];

  // Validate if the addresses are valid and not zero 
  for (const value of data)
    if (!ethers.utils.isAddress(value) || Number(value) === 0) 
      throw new Error(`Invalid value: ${value}`);

  const encodedData = ethers.utils.solidityPack(["address", "address"], data);
  const encodedCall = iface.encodeFunctionData("initialize", [encodedData]);
  
  const deployment = await factory.deploy(
    implementation.address,
    encodedCall,
  );

  await deployment.deployed();

  log(`MatchingEngineProxy deployed at ${deployment.address}`);
  writeDeployedContract(config.chainId, "MatchingEngineProxy", deployment.address);

  return deployment;
}