// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {MatchingEngineBase} from "./MatchingEngineBase.sol";

contract MatchingEngine is MatchingEngineBase {
    constructor(
        address tokenBridge,
        address circleIntegration,
        address curve,
        int8 nativeTokenPoolIndex
    ) MatchingEngineBase(tokenBridge, circleIntegration, curve, nativeTokenPoolIndex) {}
}
