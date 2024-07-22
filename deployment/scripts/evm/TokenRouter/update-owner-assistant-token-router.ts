import { TokenRouter } from "../../../contract-bindings";
import { evm, getContractInstance, getContractAddress, logComparison } from "../../../helpers";
import { getConfigurationDifferences } from "./utils";
import confirm from '@inquirer/confirm';

evm.runOnEvmsSequentially("update-owner-assistant-token-router", async (chain, signer, log) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const diff = await getConfigurationDifferences(chain);

  log(`TokenRouter configuration differences on chain ${chain.chainId}:`);
  logComparison('OwnerAssistant', diff.ownerAssistant, log);

  if (diff.ownerAssistant.onChain === diff.ownerAssistant.offChain) {
    log(`No differences found on chain ${chain.chainId}`);
    return;
  }

  const updateOwnerAssistant: boolean = await confirm({ message: 'Continue?', default: false });
  if (!updateOwnerAssistant){
    log(`OwnerAssistant update aborted on chain ${chain.chainId}`);
    return;
  }

  const ownerAddress = await tokenRouter.getOwner();
  const signerAddress = await signer.getAddress();
  if (signerAddress !== ownerAddress) {
    throw new Error(`Signer address ${signerAddress} is not the owner of TokenRouter on chain ${chain.chainId}`);
  }

  log(`Updating OwnerAssistant on chain ${chain.chainId}`);
  await tokenRouter.updateOwnerAssistant(diff.ownerAssistant.offChain);
});