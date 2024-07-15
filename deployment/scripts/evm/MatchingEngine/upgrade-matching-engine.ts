import { runOnEvms, ChainInfo, LoggerFn, getContractInstance, getContractAddress, getDependencyAddress } from "../../../helpers";
import { ethers } from "ethers";
import { deployImplementation, getMachingEngineConfiguration } from "./utils";
import { MatchingEngine } from "../../../contract-bindings";
import { MatchingEngineConfiguration } from "../../../config/config-types";
import chalk from "chalk";

runOnEvms("upgrade-matching-engine", async (chain: ChainInfo, signer: ethers.Signer, log: LoggerFn) => {

  console.warn(chalk.yellow("This script is deprecated due to the only MatchingEngine contract is deployed in Solana."))
  throw new Error("This script is deprecated due to the only MatchingEngine contract is deployed in Solana.");

  const currentImplementationAddress = getContractAddress("MatchingEngineImplementation", chain.chainId);
  const proxyAddress = getContractAddress("MatchingEngineProxy", chain.chainId);
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

  if (token.toLowerCase() !== tokenAddress.toLowerCase())
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