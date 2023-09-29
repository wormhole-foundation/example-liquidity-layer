// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {State} from "./State.sol";
import {TargetInfo, getEndpoints, getTargetInfos} from "./Storage.sol";

abstract contract Admin is Ownable {
	function enableEndpoint(uint16 chain, bytes32 endpointAddress) external onlyOwner {
		getEndpoints().endpoints[chain] = endpointAddress;
	}

	function addTargetInfo(uint16 chain, TargetInfo memory targetInfo) external onlyOwner {
		getTargetInfos().targetInfos[chain] = targetInfo;
	}
}
