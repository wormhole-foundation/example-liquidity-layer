// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenRouterState} from "../../interfaces/ITokenRouterState.sol";

import "./Errors.sol";
import {FastTransferParameters} from "../../interfaces/ITokenRouterTypes.sol";
import {
    getRouterEndpointState,
    getFastTransferParametersState,
    getCircleDomainsState
} from "./Storage.sol";

import {WormholeCctpTokenMessenger} from "../../shared/WormholeCctpTokenMessenger.sol";

abstract contract State is ITokenRouterState, WormholeCctpTokenMessenger {
    // Immutable state.
    address immutable _deployer;
    IERC20 immutable _orderToken;

    // Matching engine info.
    uint16 immutable _matchingEngineChain;
    bytes32 immutable _matchingEngineAddress;
    uint32 immutable _matchingEngineDomain;

    // Consts.
    uint32 constant NONCE = 0;
    uint8 constant FAST_FINALITY = 200;
    uint24 constant MAX_BPS_FEE = 1000000; // 10,000.00 bps (100%)

    constructor(
        address token_,
        address wormhole_,
        address cctpTokenMessenger_,
        uint16 matchingEngineChain_,
        bytes32 matchingEngineAddress_,
        uint32 matchingEngineDomain_
    ) WormholeCctpTokenMessenger(wormhole_, cctpTokenMessenger_) {
        assert(token_ != address(0));
        assert(matchingEngineChain_ != 0);
        assert(matchingEngineAddress_ != bytes32(0));

        _deployer = msg.sender;
        _orderToken = IERC20(token_);
        _matchingEngineChain = matchingEngineChain_;
        _matchingEngineAddress = matchingEngineAddress_;
        _matchingEngineDomain = matchingEngineDomain_;
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
    function getDomain(uint16 chain) public view returns (uint32) {
        return getCircleDomainsState().domains[chain];
    }

    /// @inheritdoc ITokenRouterState
    function orderToken() external view returns (IERC20) {
        return _orderToken;
    }

    /// @inheritdoc ITokenRouterState
    function wormhole() external view returns (IWormhole) {
        return _wormhole;
    }

    /// @inheritdoc ITokenRouterState
    function wormholeChainId() external view returns (uint16) {
        return _chainId;
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
    function getInitialAuctionFee() external view returns (uint128) {
        return getFastTransferParametersState().initAuctionFee;
    }

    /// @inheritdoc ITokenRouterState
    function getBaseFee() external view returns (uint128) {
        return getFastTransferParametersState().baseFee;
    }

    /// @inheritdoc ITokenRouterState
    function getMinFee() public pure returns (uint128) {
        FastTransferParameters memory params = getFastTransferParametersState();
        return params.baseFee + params.initAuctionFee + 1;
    }

    /// @inheritdoc ITokenRouterState
    function getMinTransferAmount() external pure returns (uint128) {
        return getMinFee() + 1;
    }

    /// @inheritdoc ITokenRouterState
    function getMaxTransferAmount() external view returns (uint128) {
        return getFastTransferParametersState().maxAmount;
    }
}
