import { evm, getContractInstance, getContractAddress, contracts, getUniversalAddress } from "../../../helpers";
import { TokenRouter } from "../../../contract-bindings";
import { circle, toChain } from "@wormhole-foundation/sdk-base";

evm.runOnEvms("cross-registration-token-router", async (chain, signer, log) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const deployedTokenRouters = contracts['TokenRouterProxy'].filter((router) => router.chainId !== chain.chainId);

  for (const router of deployedTokenRouters) {
    const circleDomain = circle.toCircleChainId(chain.network, toChain(router.chainId));
    const endpoint = {
      router: getUniversalAddress(router.address),
      mintRecipient: getUniversalAddress(router.address)
    };

    if (router.chainId === 0) 
      throw new Error('Invalid chainId when register new router endpoint');

    if (Number(router.address) === 0)
      throw new Error(`Invalid router address for chainId ${router.chainId}`);

    const currentMintRecipient = await tokenRouter.getMintRecipient(router.chainId);
    if (Number(currentMintRecipient) !== 0) {
      log(`Router endpoint already registered for chainId ${router.chainId}`);
      continue;
    }

    await tokenRouter.addRouterEndpoint(router.chainId, endpoint, circleDomain);
    log(`Router endpoint added for chainId ${router.chainId}`);
  }
});
