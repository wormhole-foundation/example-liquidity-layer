import { runOnEvms, ChainInfo, LoggerFn, getContractAddress, getDeploymentArgs, getVerifyCommand } from "../../../helpers";
import { ethers } from "ethers";
import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";

runOnEvms("bytecode-verification-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  // The root path of the foundry project
  const rootPath = path.resolve('../evm/');

  // Implementation data
  const implementationName = "TokenRouter";
  const implementationPath = 'src/TokenRouter/TokenRouter.sol';
  const implementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
  const implementationDeploymentArgs = getDeploymentArgs("TokenRouterImplementation", chain.chainId);
  const implementationConstructorSignature = "constructor(address,address,address,uint16,bytes32,bytes32,uint32)";
  const verifyImplementationCommand = getVerifyCommand(
    implementationName, 
    implementationPath,
    implementationAddress, 
    implementationConstructorSignature, 
    implementationDeploymentArgs, 
    chain.chainId
  );
  
  // Proxy data
  const proxyName = "ERC1967Proxy";
  const proxyPath = 'lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol';
  const proxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const proxyDeploymentArgs = getDeploymentArgs("TokenRouterProxy", chain.chainId);
  const proxyConstructorSignature = "constructor(address,bytes)";
  const verifyProxyCommand = getVerifyCommand(
    proxyName,
    proxyPath, 
    proxyAddress, 
    proxyConstructorSignature, 
    proxyDeploymentArgs, 
    chain.chainId
  );

  log(chalk.green("Verifying implementation bytecode..."));
  execSync(verifyImplementationCommand, { stdio: "inherit", cwd: rootPath });
  console.log()

  log(chalk.green("Verifying proxy bytecode..."));
  execSync(verifyProxyCommand, { stdio: "inherit", cwd: rootPath });
  console.log()
});