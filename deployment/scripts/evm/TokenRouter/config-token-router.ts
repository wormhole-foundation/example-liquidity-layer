import { ChainInfo, LoggerFn, getContractInstance, getContractAddress, runOnEvmsSequentially, ValueDiff } from "../../../helpers";
import { ethers } from "ethers";
import { getConfigurationDifferences, logDiff } from "./utils";
import confirm from '@inquirer/confirm';
import { TokenRouter } from "../../../contract-bindings";
import { FastTransferParametersStruct } from "../../../contract-bindings/ITokenRouter";

runOnEvmsSequentially("config-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const diff = await getConfigurationDifferences(chain);

  log(`TokenRouter configuration differences on chain ${chain.chainId}:`);
  logDiff(diff, log);

  const deployConfig: boolean = await confirm({ message: 'Continue?', default: false });
  if (!deployConfig){
    log(`Configuration deployment aborted on chain ${chain.chainId}`);
    return;
  }

  const { cctpAllowance, fastTransferParameters } = diff;

  // Fast transfer parameters
  await updateFastTransferParameters(tokenRouter, fastTransferParameters, log);

  // CCTP allowance
  if (cctpAllowance.onChain.toString() !== cctpAllowance.offChain.toString()) {
    await tokenRouter.setCctpAllowance(cctpAllowance.offChain);
    log(`CCTP allowance updated to ${cctpAllowance.offChain}`);
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