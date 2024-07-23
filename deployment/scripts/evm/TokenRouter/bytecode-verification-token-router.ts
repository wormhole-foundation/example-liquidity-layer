import { evm, getContractAddress, getDeploymentArgs, getVerifyCommand, verificationApiKeys, flattenObject } from "../../../helpers";
import { execSync } from "child_process";
import path from "path";
import chalk from "chalk";

evm.runOnEvms("bytecode-verification-token-router", async (chain, signer, log) => {
  // The root path of the foundry project
  const rootPath = path.resolve('../evm/');

  const verifiersData = verificationApiKeys.find((x) => x.chainId == chain.chainId);
  const verifiers = flattenObject(verifiersData!);
  delete verifiers.chainId;

  for (let [name, apiKey] of Object.entries(verifiers)) {
    name = name.split("-")[0];

    // Implementation data
    const implementationName = "TokenRouter";
    const implementationPath = 'src/TokenRouter/TokenRouter.sol';
    const implementationAddress = getContractAddress("TokenRouterImplementation", chain.chainId);
    const implementationDeploymentArgs = getDeploymentArgs("TokenRouterImplementation", chain.chainId);
    const implementationConstructorSignature = "constructor(address,address,address,uint16,bytes32,bytes32,uint32)";
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