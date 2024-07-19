import { runOnEvms, ChainInfo, LoggerFn, getContractAddress, getDeploymentArgs, getVerifyCommand, verificationApiKeys, flattenObject } from "../../../helpers";
import { ethers } from "ethers";
import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";

runOnEvms("bytecode-verification-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  // The root path of the foundry project
  const rootPath = path.resolve('../evm/');


  const verifiersData = verificationApiKeys.find((x) => x.chainId == chain.chainId);
  const verifiers = flattenObject(verifiersData!);
  delete verifiers.chainId;

  for (let [name, apiKey] of Object.entries(verifiers)) {
    name = name.split("-")[0];

    // Implementation data
    const implementationName = "MatchingEngine";
    const implementationPath = 'src/MatchingEngine/MatchingEngine.sol';
    const implementationAddress = getContractAddress("MatchingEngineImplementation", chain.chainId);
    const implementationDeploymentArgs = getDeploymentArgs("MatchingEngineImplementation", chain.chainId);
    const implementationConstructorSignature = "constructor(address,address,address,uint24,uint24,uint8,uint8,uint8)";
    const verifyImplementationCommand = getVerifyCommand(
      chain,
      implementationName, 
      implementationPath,
      implementationAddress, 
      implementationConstructorSignature, 
      implementationDeploymentArgs, 
      name,
      apiKey
    );
    
    // Proxy data
    const proxyName = "ERC1967Proxy";
    const proxyPath = 'lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol';
    const proxyAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
    const proxyDeploymentArgs = getDeploymentArgs("MatchingEngineProxy", chain.chainId);
    const proxyConstructorSignature = "constructor(address,bytes)";
    const verifyProxyCommand = getVerifyCommand(
      chain,
      proxyName,
      proxyPath, 
      proxyAddress, 
      proxyConstructorSignature, 
      proxyDeploymentArgs, 
      name,
      apiKey
    );

    log(chalk.green(`Verifying bytecode on ${name}...`));
    log(chalk.green("Verifying implementation bytecode..."));
    execSync(verifyImplementationCommand, { stdio: "inherit", cwd: rootPath });
    console.log()

    log(chalk.green("Verifying proxy bytecode..."));
    execSync(verifyProxyCommand, { stdio: "inherit", cwd: rootPath });
    console.log()
  }
});