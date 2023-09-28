// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Messages} from "../Messages.sol";

import {OrderRouterBase} from "./OrderRouterBase.sol";

abstract contract RedeemFill is OrderRouterBase {
	using BytesParsing for bytes;
	using Messages for *;
}
