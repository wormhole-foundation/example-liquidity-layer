// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenRouterState} from "../../interfaces/ITokenRouterState.sol";

import "./Errors.sol";
import {FastTransferParameters} from "../../interfaces/ITokenRouterTypes.sol";
import {getRouterEndpointState, getFastTransferParametersState} from "./Storage.sol";

abstract contract State is ITokenRouterState {
    // Immutable state.
    address immutable _deployer;
    IERC20 immutable _orderToken;
    ICircleIntegration immutable _wormholeCctp;
    uint16 immutable _wormholeChainId;
    IWormhole immutable _wormhole;

    // Matching engine info.
    uint16 immutable _matchingEngineChain;
    bytes32 immutable _matchingEngineAddress;

    // Consts.
    uint32 constant NONCE = 0;
    uint8 constant FAST_FINALITY = 200;
    uint24 constant MAX_BPS_FEE = 1000000; // 10,000.00 bps (100%)

    constructor(
        address token_,
        address wormholeCctp_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_
    ) {
        assert(token_ != address(0));
        assert(wormholeCctp_ != address(0));
        assert(matchingEngineChain_ != 0);
        assert(matchingEngineAddress_ != bytes32(0));

        _deployer = msg.sender;
        _orderToken = IERC20(token_);
        _matchingEngineChain = matchingEngineChain_;
        _matchingEngineAddress = matchingEngineAddress_;
        _wormholeCctp = ICircleIntegration(wormholeCctp_);
        _wormholeChainId = _wormholeCctp.chainId();
        _wormhole = _wormholeCctp.wormhole();
    }

    /// @inheritdoc ITokenRouterState
    function getDeployer() external view returns (address) {
        return _deployer;
    }

    /// @inheritdoc ITokenRouterState
    function getRouter(uint16 chain) public view returns (bytes32) {
        return getRouterEndpointState().endpoints[chain];
    }

    /// @inheritdoc ITokenRouterState
    function isFillRedeemed(bytes32 fillHash) external view returns (bool) {
        return _wormholeCctp.isMessageConsumed(fillHash);
    }

    /// @inheritdoc ITokenRouterState
    function orderToken() external view returns (IERC20) {
        return _orderToken;
    }

    /// @inheritdoc ITokenRouterState
    function wormholeCctp() external view returns (ICircleIntegration) {
        return _wormholeCctp;
    }

    /// @inheritdoc ITokenRouterState
    function wormholeChainId() external view returns (uint16) {
        return _wormholeChainId;
    }

    /// @inheritdoc ITokenRouterState
    function fastTransfersEnabled() external view returns (bool) {
        return getFastTransferParametersState().enabled;
    }

    /// @inheritdoc ITokenRouterState
    function getFastTransferParameters() external pure returns (FastTransferParameters memory) {
        return getFastTransferParametersState();
    }

    /// @inheritdoc ITokenRouterState
    function getMinTransferAmount() external pure returns (uint256) {
        FastTransferParameters memory params = getFastTransferParametersState();

        return params.baseFee + params.initAuctionFee + 1;
    }

    /// @inheritdoc ITokenRouterState
    function getMaxTransferAmount() external view returns (uint128) {
        return getFastTransferParametersState().maxAmount;
    }

    /// @inheritdoc ITokenRouterState
    function getInitialAuctionFee() external view returns (uint128) {
        return getFastTransferParametersState().initAuctionFee;
    }

    /// @inheritdoc ITokenRouterState
    function getBaseFee() external view returns (uint128) {
        return getFastTransferParametersState().baseFee;
    }
}
