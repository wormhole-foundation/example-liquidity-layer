// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import "./ITokenRouterTypes.sol";

interface ITokenRouterState {
    /**
     * @notice Returns the router address for a given chain ID.
     * @param chain The Wormhole chain ID.
     */
    function getRouter(uint16 chain) external view returns (bytes32);

    /**
     * @notice Returns allow listed token address for this router.
     */
    function orderToken() external view returns (IERC20);

    /**
     * @notice Returns the Wormhole Circle integration contract interface.
     */
    function wormholeCctp() external view returns (ICircleIntegration);

    /**
     * @notice Returns the Wormhole chain ID.
     */
    function wormholeChainId() external view returns (uint16);

    /**
     * @notice Returns true if the `Fill` has been redeemed.
     * @param fillHash The hash of the `Fill` Wormhole message.
     */
    function isFillRedeemed(bytes32 fillHash) external view returns (bool);

    /**
     * @notice Returns the original `deployer` of the contracts.
     * @dev This is not the `owner` of the contracts.
     */
    function getDeployer() external view returns (address);

    /**
     * @notice Returns a boolean which indicates if outbound fast transfers are enabled.
     * @dev The `owner` of the contract can disable fast transfers by setting the
     * `feeInBps` to zero.
     */
    function fastTransfersEnabled() external view returns (bool);

    /**
     * @notice Returns the current `FastTransferParameters` struct from storage. See
     * `ITokenRouterTypes.sol` for the struct definition.
     */
    function getFastTransferParameters() external view returns (FastTransferParameters memory);

    /**
     * @notice Returns the minimum transfer amount for fast transfers.
     */
    function getMinTransferAmount() external view returns (uint128);

    /**
     * @notice Returns the minimum fee for fast transfers. This includes the `baseFee`
     * and `initialAuctionFee`.
     */
    function getMinFee() external pure returns (uint128);

    /**
     * @notice Returns the maximum transfer amount for fast transfers.
     */
    function getMaxTransferAmount() external view returns (uint128);

    /**
     * @notice Returns the initial auction fee for fast transfers. This is the fee
     * the relayer is paid for starting a fast transfer auction.
     */
    function getInitialAuctionFee() external view returns (uint128);

    /**
     * @notice Returns the base fee for fast transfers. This is the fee the relayer
     * is paid for relaying the CCTP message associated with a fast transfer. This fee
     * is only paid in the a fast transfer auction does not occur.
     */
    function getBaseFee() external view returns (uint128);
}
