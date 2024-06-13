import { runOnEvms, ChainInfo, LoggerFn, getContractInstance, getContractAddress, getDependencyAddress } from "../../../helpers";
import { ethers } from "ethers";
import { deployImplementation, getMachingEngineConfiguration } from "./utils";
import { MatchingEngine } from "../../../contract-bindings";
import { MatchingEngineConfiguration } from "../../../config/config-types";

runOnEvms("upgrade-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {
  const currentImplementationAddress = await getContractAddress("MatchingEngineImplementation", chain.chainId);
  const proxyAddress = await getContractAddress("MatchingEngineProxy", chain.chainId);
  const proxy = (await getContractInstance("MatchingEngine", proxyAddress, chain)) as MatchingEngine;
  const config = await getMachingEngineConfiguration(chain);

  log(`Checking immutables for MatchingEngine...`);
  await checkImmutables(proxy, config, chain);

  const newImplementation = await deployImplementation(signer, config, log);

  log(`Upgrading MatchingEngineImplementation implementation from ${currentImplementationAddress} to ${newImplementation.address}`);
  await proxy.upgradeContract(newImplementation.address);
});

async function checkImmutables(matchingEngine: MatchingEngine, config: MatchingEngineConfiguration, chain: ChainInfo) {
  const tokenAddress = getDependencyAddress("token", chain.chainId);
  const [
    token,
    userPenaltyRewardBps,
    initialPenaltyBps,
    auctionDuration,
    auctionGracePeriod,
    auctionPenaltyBlocks,
  ] = await Promise.all([
    matchingEngine.token(),
    matchingEngine.getUserPenaltyRewardBps(),
    matchingEngine.getInitialPenaltyBps(),
    matchingEngine.getAuctionDuration(),
    matchingEngine.getAuctionGracePeriod(),
    matchingEngine.getAuctionPenaltyBlocks(),
  ]);

  if (token !== tokenAddress)
    throw new Error(`Token is an immutable value and cannot be changed.`);

  if (userPenaltyRewardBps !== Number(config.userPenaltyRewardBps))
    throw new Error(`UserPenaltyRewardBps is an immutable value and cannot be changed.`);

  if (initialPenaltyBps !== Number(config.initialPenaltyBps))
    throw new Error(`InitialPenaltyBps is an immutable value and cannot be changed.`);

  if (auctionDuration !== Number(config.auctionDuration))
    throw new Error(`AuctionDuration is an immutable value and cannot be changed.`);

  if (auctionGracePeriod !== Number(config.auctionGracePeriod)) 
    throw new Error(`AuctionGracePeriod is an immutable value and cannot be changed.`);

  if (auctionPenaltyBlocks !== Number(config.auctionPenaltyBlocks))
    throw new Error(`AuctionPenaltyBlocks is an immutable value and cannot be changed.`);
}