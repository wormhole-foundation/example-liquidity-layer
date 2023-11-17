// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import "./Types.sol";
import "../MatchingEngine/assets/Storage.sol";

interface IMatchingEngineState {
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
     * @notice Returns the Wormhole Circle integration contract interface.
     */
    function wormholeCctp() external view returns (ICircleIntegration);

    /**
     * @notice Returns the Wormhole chain ID.
     */
    function wormholeChainId() external view returns (uint16);

    function maxBpsFee() external pure returns (uint24);

    function liveAuctionInfo(bytes32 auctionId) external view returns (LiveAuctionData memory);

    function getAuctionStatus(bytes32 auctionId) external view returns (AuctionStatus);

    function getAuctionDuration() external view returns (uint8);

    function getAuctionGracePeriod() external view returns (uint8);

    function getAuctionPenaltyBlocks() external view returns (uint8);

    function auctionConfig() external pure returns (AuctionConfig memory);
}
