// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {IMatchingEngineState} from "../../interfaces/IMatchingEngineState.sol";

import "./Errors.sol";

abstract contract State is IMatchingEngineState {
    // Immutable state.
    address immutable _deployer;
    uint16 immutable _wormholeChainId;
    IWormhole immutable _wormhole;
    ICircleIntegration immutable _wormholeCctp;
    IERC20 immutable _token;

    // Consts.
    uint8 constant FINALITY = 1;
    uint32 constant NONCE = 0;
    uint24 constant INITIAL_PENALTY_BPS = 100000; // 1000.00 bps (10%)
    uint24 constant MAX_BPS_FEE = 1000000; // 10,000.00 bps (100%)
    uint8 constant AUCTION_DURATION = 2; // 2 blocks == ~6 seconds
    uint8 constant AUCTION_GRACE_PERIOD = 6; // includes AUCTION_DURATION
    uint8 constant PENALTY_BLOCKS = 20;

    constructor(address wormholeCctp_, address cctpToken_) {
        assert(wormholeCctp_ != address(0));
        assert(cctpToken_ != address(0));

        _deployer = msg.sender;
        _wormholeCctp = ICircleIntegration(wormholeCctp_);
        _wormholeChainId = _wormholeCctp.chainId();
        _wormhole = _wormholeCctp.wormhole();
        _token = IERC20(cctpToken_);
    }

    /// @inheritdoc IMatchingEngineState
    function getDeployer() external view returns (address) {
        return _deployer;
    }
}
