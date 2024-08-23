import { evm, getContractInstance, getContractAddress, contracts, getChainInfo } from "../../../helpers";
import { TokenRouter } from "../../../contract-bindings";
import { ChainId, chainToPlatform, circle, toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { getTokenRouterProgram } from "../../../helpers/solana";
import { Connection } from "@solana/web3.js";

evm.runOnEvms("cross-registration-token-router", async (chain, _, log) => {
  const tokenRouterAddress = getContractAddress("TokenRouterProxy", chain.chainId);
  const tokenRouter = (await getContractInstance("TokenRouter", tokenRouterAddress, chain)) as TokenRouter;
  const deployedTokenRouters = contracts['TokenRouterProxy'].filter((router) => router.chainId !== chain.chainId);
  
  for (const router of deployedTokenRouters) {
    const circleDomain = circle.toCircleChainId(chain.network, toChain(router.chainId));
    const routerChain = toChain(router.chainId);
    const routerAddress = toUniversal(routerChain, router.address).toString();
    const mintRecipient = getMintRecipient(chain.chainId, routerAddress);
    const endpoint = {
      router: routerAddress,
      mintRecipient
    };

    if (router.chainId === 0) 
      throw new Error('Invalid chainId when register new router endpoint');

    if (Number(router.address) === 0)
      throw new Error(`Invalid router address for chainId ${router.chainId}`);
    
    const currentMintRecipient = await tokenRouter.getMintRecipient(router.chainId);

    if (Number(currentMintRecipient) !== 0) {
      log(`Router endpoint already registered for chainId ${router.chainId}. Updating...`);
      await tokenRouter.updateRouterEndpoint(router.chainId, endpoint, circleDomain);
      continue;
    }

    log(`Adding router endpoint for chainId ${router.chainId}. Endpoint: ${JSON.stringify(endpoint)}`);
    await tokenRouter.addRouterEndpoint(router.chainId, endpoint, circleDomain);
  }
});


function getMintRecipient(chainId: ChainId, routerAddress: string): string {
  const platform = chainToPlatform(toChain(chainId));
  
  if (platform === "Evm")
    return routerAddress;

  const chain = "Solana";
  const chainInfo = getChainInfo(toChainId(chain));
  const connection = new Connection(chainInfo.rpc, chainInfo.commitmentLevel || "confirmed");
  const tokenRouter = getTokenRouterProgram(connection);

  return toUniversal(chain, tokenRouter.cctpMintRecipientAddress().toBytes()).toString();
}