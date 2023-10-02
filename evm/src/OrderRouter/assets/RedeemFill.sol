// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Messages} from "../../shared/Messages.sol";

import {State} from "./State.sol";

abstract contract RedeemFill is State {
	using BytesParsing for bytes;
	using Messages for *;
}
