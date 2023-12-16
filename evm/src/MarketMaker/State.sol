// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IMatchingEngine} from "../interfaces/IMatchingEngine.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Errors.sol";
import "../interfaces/IMarketMakerTypes.sol";

abstract contract State {
    uint24 constant MAX_BPS = 1000000; // 100%

    // --------------------- Immutable storage ---------------------
    IMatchingEngine immutable _matchingEngine;
    address immutable _multiSig;
    IERC20 immutable _token;

    // --------------------- Mutable storage ---------------------
    address _relayer;
    Vault _vault;
    mapping(address => Deposit) _deposits;

    constructor(
        address multiSig_,
        address token_,
        address relayer_,
        uint24 performanceFee_,
        uint24 maxUtilizationRatio_,
        uint128 initialDeposit_
    ) {
        _matchingEngine = IMatchingEngine(msg.sender);
        _multiSig = multiSig_;
        _token = IERC20(token_);

        // Set the relayer address
        if (relayer_ == address(0)) {
            revert ErrZeroAddress();
        } else {
            _relayer = relayer_;
        }

        if (performanceFee_ > MAX_BPS) {
            revert ErrInvalidPerformanceFee();
        } else if (maxUtilizationRatio_ > MAX_BPS) {
            revert ErrInvalidMaxUtilizationRatio();
        } else {
            _vault = Vault({
                performanceFeeBps: performanceFee_,
                maxUtilizationRatioBps: maxUtilizationRatio_,
                fees: 0,
                deposits: 0,
                outstanding: 0
            });
        }

        // Create relayer LP position.
        _deposits[relayer_] = Deposit({totalFees: 0, accruedFees: 0, amount: initialDeposit_});
    }

    function relayer() external view returns (address) {
        return _relayer;
    }

    function token() external view returns (IERC20) {
        return _token;
    }

    function totalFees() external view returns (uint128) {
        return _vault.fees;
    }

    function totalDeposits() external view returns (uint128) {
        return _vault.deposits;
    }

    function balanceOf(address account) external view returns (uint128) {
        return _deposits[account].amount;
    }

    modifier onlyMatchingEngine() {
        if (msg.sender != address(_matchingEngine)) {
            revert ErrCallerNotMatchingEngine();
        }
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != _relayer) {
            revert ErrCallerNotRelayer();
        }
        _;
    }
}
