// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Messages} from "../../Messages.sol";

import {Config} from "./Config.sol";

abstract contract RedeemFill is Config {
	using BytesParsing for bytes;
	using Messages for *;
}
