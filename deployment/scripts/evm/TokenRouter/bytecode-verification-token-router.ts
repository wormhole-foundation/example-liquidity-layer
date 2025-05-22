import { evm, getContractAddress, getDeploymentArgs, getVerifyCommand, verificationApiKeys, flattenObject } from "../../../helpers";
import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";

evm.runOnEvms("bytecode-verification-token-router", async (chain, signer, log) => {
  // The root path of the foundry project
  const rootPath = path.resolve('../evm/');

  const verifiers = verificationApiKeys[chain.chainId];
  if (!verifiers) {
    log(chalk.red(`No verifiers found for chain ${chain.chainId}`));
    return;
  }

  for (let [verifier, data] of Object.entries(verifiers)) {
    const apiKey = typeof data === 'string' ? data : data.key;
    const verifierUrl = typeof data === 'string' ? undefined : data.apiUrl;

    // Implementation data
    const implementationName = "TokenRouter";
    const implementationPath = 'src/TokenRouter/TokenRouter.sol';
    const implementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
    const implementationDeploymentArgs = getDeploymentArgs("TokenRouterImplementation", chain.chainId);
    const implementationConstructorSignature = "constructor(address,address,address,uint16,bytes32,bytes32,uint32)";
    const verifyImplementationCommand = getVerifyCommand({
      chain,
      contractName: implementationName, 
      contractPath: implementationPath,
      contractAddress: implementationAddress, 
      constructorSignature: implementationConstructorSignature, 
      constructorArgs: implementationDeploymentArgs, 
      verifier,
      verifierUrl,
      apiKey
    });
    
    // Proxy data
    const proxyName = "ERC1967Proxy";
    const proxyPath = 'lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol';
    const proxyAddress = getContractAddress("TokenRouterProxy", chain.chainId);
    const proxyDeploymentArgs = getDeploymentArgs("TokenRouterProxy", chain.chainId);
    const proxyConstructorSignature = "constructor(address,bytes)";
    const verifyProxyCommand = getVerifyCommand({
      chain,
      contractName: proxyName, 
      contractPath: proxyPath,
      contractAddress: proxyAddress, 
      constructorSignature: proxyConstructorSignature, 
      constructorArgs: proxyDeploymentArgs, 
      verifier,
      verifierUrl,
      apiKey
    });

    log(chalk.green(`Verifying bytecode on ${verifier}...`));
    log(chalk.green("Verifying implementation bytecode..."));
    execSync(verifyImplementationCommand, { stdio: "inherit", cwd: rootPath });
    console.log()

    log(chalk.green("Verifying proxy bytecode..."));
    execSync(verifyProxyCommand, { stdio: "inherit", cwd: rootPath });
    console.log()
  }
});