// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

struct RedeemedFill {
	bytes32 sender;
	uint16 senderChain;
	address token;
	uint256 amount;
	bytes message;
}

interface IRedeemFill {
	/**
	 * @notice Redeem a fill sent by either another Order Router or the Matching Engine.
	 */
	function redeemFill(bytes calldata encodedVaa) external payable returns (RedeemedFill memory);

	/**
	 * @notice Redeem a fill sent by either another Order Router or the Matching Engine via CCTP.
	 */
	function redeemFill(
		ICircleIntegration.RedeemParameters calldata redeemParams
	) external payable returns (RedeemedFill memory);
}
