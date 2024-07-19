import { ChainInfo, LoggerFn, getContractInstance, getContractAddress, runOnEvms, contracts, getUniversalAddress } from "../../../helpers";
import { ethers } from "ethers";
import { TokenRouter } from "../../../contract-bindings";
import { circle } from "@wormhole-foundation/sdk-base";

runOnEvms("cross-registration-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const deployedTokenRouters = contracts['TokenRouterProxy'].filter((router) => router.chainId !== chain.chainId);

  for (const router of deployedTokenRouters) {
    const circleDomain = circle.toCircleChainId(chain.network, router.chainId);
    const endpoint = {
      router: getUniversalAddress(router.address),
      mintRecipient: getUniversalAddress(router.address)
    };


    // check if is already registered
    
    if (router.chainId === 0) 
      throw new Error('Invalid chainId when register new router endpoint');

    if (Number(router.address) === 0)
      throw new Error(`Invalid router address for chainId ${router.chainId}`);

    const isAlreadyRegistered = 

    await tokenRouter.addRouterEndpoint(router.chainId, endpoint, circleDomain);
    log(`Router endpoint added for chainId ${router.chainId}`);
  }
});

function isRouterEndpointRegistered(router: TokenRouter, chainId: number, endpoint: { router: string; mintRecipient: string }) {
  const mintRecipient = await tokenRouter.getMintRecipient(router.chainId, endpoint);
  return Number(mintRecipient) !== 0;
}