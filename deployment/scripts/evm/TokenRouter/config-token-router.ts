import { ChainInfo, LoggerFn, getContractInstance, getContractAddress, runOnEvmsSequentially, ValueDiff } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";
import confirm from '@inquirer/confirm';
import { TokenRouter } from "../../../contract-bindings";
import { FastTransferParametersStruct } from "../../../contract-bindings/evm/out/ITokenRouter";

runOnEvmsSequentially("config-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const tokenRouterAddress = await getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const diff = await getConfigurationDifferences(chain);

  log(`TokenRouter configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);

  const deployConfig: boolean = await confirm({ message: 'Continue?', default: false });
  if (!deployConfig){
    log(`Configuration deployment aborted on chain ${chain.chainId}`);
    return;
  }

  const { cctpAllowance, routerEndpoints, fastTransferParameters } = diff;

  // Fast transfer parameters
  await updateFastTransferParameters(tokenRouter, fastTransferParameters, log);

  // CCTP allowance
  if (cctpAllowance.onChain.toString() !== cctpAllowance.offChain.toString()) {
    await tokenRouter.setCctpAllowance(cctpAllowance.offChain);
    log(`CCTP allowance updated to ${cctpAllowance.offChain}`);
  }

  // Router endpoints
  for (const { chainId, router, mintRecipient, circleDomain } of routerEndpoints) {
    const offChainEndpoint = {
      router: router.offChain,
      mintRecipient: mintRecipient.offChain
    };
    
    // Add new router endpoint if all values are zero
    if (Number(router?.onChain) === 0 && Number(mintRecipient?.onChain) === 0 && Number(circleDomain?.onChain) === 0) {
      if (chainId === 0) 
        throw new Error('Invalid chainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for chainId ${chainId}`);

      await tokenRouter.addRouterEndpoint(chainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint added for chainId ${chainId}`);
      continue;
    }

    // Disable router endpoint, must be the three values zero
    if (Number(router?.offChain) === 0 && Number(mintRecipient?.offChain) === 0 && Number(circleDomain?.offChain) === 0) {
      await tokenRouter.disableRouterEndpoint(chainId);
      log(`Router endpoint disabled for chainId ${chainId}`);
      continue;
    }

    // Update router endpoint
    if (
      router?.onChain.toString() !== router?.offChain.toString() || 
      mintRecipient?.onChain.toString() !== mintRecipient?.offChain.toString() || 
      circleDomain?.onChain.toString() !== circleDomain?.offChain.toString()
    ) {
      if (chainId === 0) 
        throw new Error('Invalid chainId when adding new router endpoint');

      if (Number(offChainEndpoint.router) === 0 || Number(offChainEndpoint.mintRecipient) === 0)
        throw new Error(`Invalid router or mintRecipient endpoint for chainId ${chainId}`);

      await tokenRouter.updateRouterEndpoint(chainId, offChainEndpoint, circleDomain.offChain);
      log(`Router endpoint updated for chainId ${chainId}`);
      continue;
    }
  }
});

async function updateFastTransferParameters(tokenRouter: TokenRouter, params: Record<string, ValueDiff>, log: LoggerFn) {
  let enableFastTransfers = false;
  let updatedFastTransferParameters = false;

  // Check if any of the fast transfer parameters have changed
  for (const [key, value] of Object.entries(params)) {
    if (value.onChain.toString() !== value.offChain.toString()) {
      // Check if we are updating the enabled flag
      if (key === "enabled") {
        enableFastTransfers = true;
      } else {
        updatedFastTransferParameters = true;
      }
    }
  }

  // Update fast transfer parameters if any of the values have changed (except for the enabled flag)
  if (updatedFastTransferParameters) {

    if (params.maxAmount.offChain <= params.baseFee.offChain + params.initAuctionFee.offChain)
      throw new Error(`Invalid fast transfer parameters: maxAmount must be greater than baseFee + initAuctionFee`);

    await tokenRouter.updateFastTransferParameters({
      enabled: params.enabled.offChain,
      baseFee: params.baseFee.offChain,
      maxAmount: params.maxAmount.offChain,
      initAuctionFee: params.initAuctionFee.offChain
    } as FastTransferParametersStruct);
    log(`Fast transfer parameters updated`);
  } 

  // Enable / Disable fast transfers if only the enabled flag has changed
  else if (enableFastTransfers) {
    const enabled = params.enabled.offChain;
    await tokenRouter.enableFastTransfers(enabled);
    if (enabled)
      log(`Fast transfers enabled`);
    else
      log(`Fast transfers disabled`);
  }
} 