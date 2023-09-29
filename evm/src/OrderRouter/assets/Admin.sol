// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {State} from "./State.sol";
import {TargetInfo, getEndpoints, getTargetInfos} from "./Storage.sol";

abstract contract Admin is Ownable {
	function addEndpoint(
		uint16 chain,
		bytes32 endpoint,
		TargetInfo memory info
	) external onlyOwner {
		getEndpoints().endpoints[chain] = endpoint;
		getTargetInfos().targetInfos[chain] = info;
	}
}
