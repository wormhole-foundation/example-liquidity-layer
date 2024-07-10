import { runOnEvms, ChainInfo, LoggerFn, getContractAddress, getDeploymentArgs, getVerifyCommand } from "../../../helpers";
import { ethers } from "ethers";
import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";

runOnEvms("bytecode-verification-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  // The root path of the foundry project
  const rootPath = path.resolve('../evm/');

  if (chain.externalId === undefined)
    throw new Error(`Chain ${chain.chainId} does not have an external ID`);

  // Implementation data
  const implementationName = "MatchingEngine";
  const implementationPath = 'src/MatchingEngine/MatchingEngine.sol';
  const implementationAddress = getContractAddress("MatchingEngineImplementation", chain.chainId);
  const implementationDeploymentArgs = getDeploymentArgs("MatchingEngineImplementation", chain.chainId);
  const implementationConstructorSignature = "constructor(address,address,address,uint24,uint24,uint8,uint8,uint8)";
  const verifyImplementationCommand = getVerifyCommand(
    implementationName, 
    implementationPath,
    implementationAddress, 
    implementationConstructorSignature, 
    implementationDeploymentArgs, 
    parseInt(chain.externalId)
  );
  
  // Proxy data
  const proxyName = "ERC1967Proxy";
  const proxyPath = 'lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol';
  const proxyAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
  const proxyDeploymentArgs = getDeploymentArgs("MatchingEngineProxy", chain.chainId);
  const proxyConstructorSignature = "constructor(address,bytes)";
  const verifyProxyCommand = getVerifyCommand(
    proxyName,
    proxyPath, 
    proxyAddress, 
    proxyConstructorSignature, 
    proxyDeploymentArgs, 
    parseInt(chain.externalId)
  );

  log(chalk.green("Verifying implementation bytecode..."));
  execSync(verifyImplementationCommand, { stdio: "inherit", cwd: rootPath });
  console.log()

  log(chalk.green("Verifying proxy bytecode..."));
  execSync(verifyProxyCommand, { stdio: "inherit", cwd: rootPath });
  console.log()
});