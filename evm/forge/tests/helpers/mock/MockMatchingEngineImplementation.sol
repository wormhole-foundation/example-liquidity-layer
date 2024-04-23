// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {MatchingEngine} from "src/MatchingEngine/MatchingEngine.sol";
import {IMatchingEngine} from "src/interfaces/IMatchingEngine.sol";

interface IMockMatchingEngine is IMatchingEngine {
    function isUpgraded() external pure returns (bool);

    function getImplementation() external view returns (address);
}

contract MockMatchingEngineImplementation is MatchingEngine {
    constructor(
        address _token,
        address _wormhole,
        address _cctpTokenMessenger,
        uint24 _userPenaltyRewardBps,
        uint24 _initialPenaltyBps,
        uint8 _auctionDuration,
        uint8 _auctionGracePeriod,
        uint8 _auctionPenaltyBlocks
    )
        MatchingEngine(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _userPenaltyRewardBps,
            _initialPenaltyBps,
            _auctionDuration,
            _auctionGracePeriod,
            _auctionPenaltyBlocks
        )
    {}

    function isUpgraded() external pure returns (bool) {
        return true;
    }
}
