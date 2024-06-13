import { runOnEvms, ChainInfo, LoggerFn, getContractInstance, getContractAddress } from "../../../helpers";
import { ethers } from "ethers";

runOnEvms("config-token-router", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const tokenRouterAddress = await getContractAddress("TokenRouter", chain.chainId);
  const tokenRouter = await getContractInstance("TokenRouter", tokenRouterAddress, chain);

});