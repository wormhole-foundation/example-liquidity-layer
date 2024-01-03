// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "../shared/Messages.sol";
import {CctpMessage} from "./IMatchingEngineTypes.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

interface IMatchingEngineFastOrders {
    /**
     * @notice Place an initial bid on a fast transfer auction. The initial bidder
     * will receive a fee for placing the initial bid.
     * @param fastTransferVaa The VAA for the fast transfer.
     * @param feeBid The fee bid to place on the auction. Must be less than the `maxFee`
     * that is encoded in the `fastTransferVaa`.
     * @dev This function calls `improveBid` internally so that subsequent bidders
     * will not waste gas when racing to start an auction.
     */
    function placeInitialBid(bytes calldata fastTransferVaa, uint128 feeBid) external;

    /**
     * @notice Improve the bid on a fast transfer auction.
     * @param auctionId The auction ID to improve the bid on.
     * @param feeBid The fee bid to place on the auction. Must be less than the
     * current bid.
     */
    function improveBid(bytes32 auctionId, uint128 feeBid) external;

    /**
     * @notice Execute a fast transfer order. This function sends the funds to
     * the rececipient on the target chain. It also penalizes the highest bidder
     * if the method is not executed during the grace period.
     * @param fastTransferVaa The VAA for the fast transfer.
     * @dev We do not verify the router path here since we already did it in
     * `placeInitialBid`.
     * @return sequence The sequence number of the VAA.
     */
    function executeFastOrder(bytes calldata fastTransferVaa)
        external
        payable
        returns (uint64 sequence);

    /**
     * @notice Execute a slow order and return the funds to the fast transfer auction
     * winner. If no fast transfer auction occured, then the funds are directed to
     * the receipient on the target chain.
     * @param fastFillVaa The VAA for the fast fill.
     * @param params The parameters for the slow order.
     * @return sequence The sequence number of the transfer VAA. Will be the default (0)
     * if no auction occured.
     */
    function executeSlowOrderAndRedeem(bytes calldata fastFillVaa, CctpMessage calldata params)
        external
        payable
        returns (uint64 sequence);

    /**
     * @notice Redeem a `FastFill` VAA. A `FastFill` is generated when the target chain
     * of a fast transfer vaa is the `MatchingEngine` chain. This function will
     * send the funds to the caller of the function.
     * @param fastFillVaa The VAA for the fast fill.
     * @return fastFill The decoded `FastFill` struct.
     */
    function redeemFastFill(bytes calldata fastFillVaa)
        external
        returns (Messages.FastFill memory);
}
