// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";

contract MatchingEngine {
	function executeOrder(bytes calldata vaa) public payable {
		return;
	}

	function executeOrder(
		ICircleIntegration.RedeemParameters calldata params
	) public payable {
		return;
	}
}
