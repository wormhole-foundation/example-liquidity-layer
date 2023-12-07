// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {Admin} from "../shared/Admin.sol";
import {Messages} from "../shared/Messages.sol";
import {getImplementationState, Implementation} from "../shared/Admin.sol";

import {MatchingEngineAdmin} from "./assets/MatchingEngineAdmin.sol";
import {MatchingEngineFastOrders} from "./assets/MatchingEngineFastOrders.sol";
import {State} from "./assets/State.sol";

contract MatchingEngineImplementation is MatchingEngineFastOrders, MatchingEngineAdmin {
    error AlreadyInitialized();

    constructor(
        address cctpToken_,
        address wormholeCctp_,
        uint24 userPenaltyRewardBps_,
        uint24 initialPenaltyBps_,
        uint8 auctionDuration_,
        uint8 auctionGracePeriod_,
        uint8 auctionPenaltyBlocks_
    )
        State(
            cctpToken_,
            wormholeCctp_,
            userPenaltyRewardBps_,
            initialPenaltyBps_,
            auctionDuration_,
            auctionGracePeriod_,
            auctionPenaltyBlocks_
        )
    {}

    function initialize() public virtual initializer {
        // This function needs to be exposed for an upgrade to pass.
    }

    modifier initializer() {
        address impl = ERC1967Upgrade._getImplementation();

        Implementation storage implementation = getImplementationState();

        if (implementation.isInitialized[impl]) {
            revert AlreadyInitialized();
        }

        // Initialize the implementation.
        implementation.isInitialized[impl] = true;

        _;
    }
}
