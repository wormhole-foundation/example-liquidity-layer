// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWormhole} from "wormhole-solidity-sdk/interfaces/IWormhole.sol";
import {ICircleIntegration} from "local-modules/wormhole/ICircleIntegration.sol";
import {ITokenMessenger} from "src/interfaces/external/ITokenMessenger.sol";
import "./IMatchingEngineTypes.sol";

interface IMatchingEngineState {
    /**
     * @notice Calculates the dynamic penalty for a given amount and number of blocks elapsed.
     * @param amount The amount to calculate the penalty for.
     * @param blocksElapsed The number of blocks elapsed since the auction started.
     * @return penalty The penalty amount.
     * @return userReward The user reward amount.
     */
    function calculateDynamicPenalty(uint64 amount, uint64 blocksElapsed)
        external
        view
        returns (uint64 penalty, uint64 userReward);

    /**
     * @notice Calculates the dynamic penalty for the specified auction.
     * @param auctionId The auction ID to calculate the penalty for.
     * @return penalty The penalty amount.
     * @return userReward The user reward amount.
     */
    function calculateDynamicPenalty(bytes32 auctionId)
        external
        view
        returns (uint64 penalty, uint64 userReward);

    /**
     * @notice Returns the original `deployer` of the contracts.
     * @dev This is not the `owner` of the contracts.
     */
    function getDeployer() external view returns (address);

    /**
     * @notice Returns the router address for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getRouter(uint16 chain) external view returns (bytes32);

    /**
     * @notice Returns the mint recipient for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getMintRecipient(uint16 chain) external view returns (bytes32);

    /**
     * @notice Returns the router endpoint for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getRouterEndpoint(uint16 chain) external view returns (RouterEndpoint memory);

    /**
     * @notice Returns the Circle domain for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getDomain(uint16 chain) external view returns (uint32);

    /**
     * @notice Returns the Wormhole contract interface.
     */
    function wormhole() external view returns (IWormhole);

    /**
     * @notice Returns the Wormhole chain ID.
     */
    function wormholeChainId() external view returns (uint16);

    /**
     * @notice Returns the address of the `feeRecipient`, which is the address that
     * receives the base fee when relaying a slow transfer.
     */
    function feeRecipient() external view returns (address);

    /**
     * @notice Returns the address of USDC on this chain.
     */
    function token() external view returns (IERC20);

    /**
     * @notice Returns the maximum fast transfer fee in bps that can be charged for a slow transfer.
     */
    function maxBpsFee() external pure returns (uint24);

    /**
     * @notice Returns the `LiveAuctionData` for the specified `auctionId`.
     */
    function liveAuctionInfo(bytes32 auctionId) external view returns (LiveAuctionData memory);

    /**
     * @notice Returns the `highestBidder` for the specified `auctionId`.
     */
    function getHighestBidder(bytes32 auctionId) external view returns (address);

    /**
     * @notice Returns the transfer amount for a particular auction.
     */
    function getAuctionAmount(bytes32 auctionId) external view returns (uint64);

    /**
     * @notice Returns the security deposit for a particular auction.
     */
    function getSecurityDeposit(bytes32 auctionId) external view returns (uint64);

    /**
     * @notice Returns the status of the specified `auctionId`.
     */
    function getAuctionStatus(bytes32 auctionId) external view returns (AuctionStatus);

    /**
     * @notice Returns the timeframe (number of blocks) for which bids can be placed on an auction.
     */
    function getAuctionDuration() external view returns (uint8);

    /**
     * @notice Returns the timeframe (number of blocks) for which the highest bidder must execute
     * the fast transfer before a penalty is incurred.
     */
    function getAuctionGracePeriod() external view returns (uint8);

    /**
     * @notice Returns the timeframe (number of blocks) for which the penalty is incurred.
     */
    function getAuctionPenaltyBlocks() external view returns (uint8);

    /**
     * @notice Returns the reward in bps (percentage of security deposit) the user will receive
     * for a delayed fast transfer.
     */
    function getUserPenaltyRewardBps() external view returns (uint24);

    /**
     * @notice Returns the initial penalty in bps (percentage of security deposit) the highest
     * bidder will incur for a delayed fast transfer.
     */
    function getInitialPenaltyBps() external view returns (uint24);

    /**
     * @notice Returns the number of blocks elapsed since the auction started.
     */
    function getAuctionBlocksElapsed(bytes32 auctionId) external view returns (uint64);

    /**
     * @notice Returns a boolean which indicates whether the specified `FastFill` has been redeemed.
     */
    function isFastFillRedeemed(bytes32 vaaHash) external view returns (bool);
}
