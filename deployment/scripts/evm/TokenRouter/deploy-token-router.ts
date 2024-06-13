import { ethers } from "ethers";
import { ERC1967Proxy__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { runOnEvms, ChainInfo, LoggerFn, writeDeployedContract } from "../../../helpers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { deployImplementation, getTokenRouterConfiguration } from "./utils";

runOnEvms("deploy-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const config = await getTokenRouterConfiguration(chain);
  const implementation = await deployImplementation(signer, config, log);
  const proxy = await deployProxy(signer, config, implementation, log);
});

async function deployProxy(signer: ethers.Signer, config: TokenRouterConfiguration, implementation: ethers.Contract, log: LoggerFn) {
  const factory = new ERC1967Proxy__factory(signer);

  const abi = ["function initialize(bytes)"];
  const iface = new ethers.utils.Interface(abi);
  const encodedData = ethers.utils.solidityPack(["address"], [config.ownerAssistant]);
  const encodedCall = iface.encodeFunctionData("initialize", [encodedData]);

  const deployment = await factory.deploy(
    implementation.address,
    encodedCall,
  );

  await deployment.deployed();

  log(`TokenRouterProxy deployed at ${deployment.address}`);

  writeDeployedContract(config.chainId, "TokenRouterProxy", deployment.address);

  return deployment;
}
