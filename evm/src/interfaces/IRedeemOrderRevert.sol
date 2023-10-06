// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

import {Messages} from "../shared/Messages.sol";

interface IRedeemOrderRevert {
    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
     */
    function redeemOrderRevert(bytes calldata encodedVaa) external returns (Messages.RevertType);

    /**
     * @notice Redeem a fill sent by either another Order Router or the Matching Engine via CCTP.
     */
    function redeemOrderRevert(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external returns (Messages.RevertType);
}
