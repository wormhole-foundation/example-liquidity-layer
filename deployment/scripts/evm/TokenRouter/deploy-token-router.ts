import { ethers } from "ethers";
import { evm, getChainInfo, LoggerFn, writeDeployedContract } from "../../../helpers";
import { TokenRouterConfiguration } from "../../../config/config-types";
import { deployImplementation, getMatchingEngineMintRecipientAddress, getTokenRouterConfiguration } from "./utils";
import { ERC1967Proxy__factory } from "../../../contract-bindings";

evm.runOnEvms("deploy-token-router", async (chain, signer, log) => {
  const config = await getTokenRouterConfiguration(chain);

  const matchingEngineMintRecipient = getMatchingEngineMintRecipientAddress();
  const implementation = await deployImplementation(chain, signer, config, matchingEngineMintRecipient, log);
  await deployProxy(signer, config, implementation, log);
});

async function deployProxy(signer: ethers.Signer, config: TokenRouterConfiguration, implementation: ethers.Contract, log: LoggerFn) {
  const factory = new ERC1967Proxy__factory(signer);
  const abi = ["function initialize(bytes)"];
  const iface = new ethers.utils.Interface(abi);
  const data = config.ownerAssistant;

  // Validate if the address are valid and not zero 
  if (!ethers.utils.isAddress(data) || Number(data) === 0) 
    throw new Error(`Invalid value: ${data}`);

  const encodedData = ethers.utils.solidityPack(["address"], [data]);
  const encodedCall = iface.encodeFunctionData("initialize", [encodedData]);

  const deployment = await factory.deploy(
    implementation.address,
    encodedCall,
  );

  await deployment.deployed();

  log(`TokenRouterProxy deployed at ${deployment.address}`);
  writeDeployedContract(config.chainId, "TokenRouterProxy", deployment.address, [implementation.address, encodedCall]);

  return deployment;
}
