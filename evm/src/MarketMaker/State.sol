// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {IMatchingEngine} from "../interfaces/IMatchingEngine.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Errors.sol";
import "../interfaces/IMarketMakerTypes.sol";

abstract contract State {
    uint24 constant MAX_BPS = 1000000; // 100%
    uint32 constant MIN_CAMPAIGN_DURATION = 201600; // ~7 days in Avax blocks.
    uint32 constant MIN_ACCOUNTING_PERIOD = 12000; // ~1 hour in Avax blocks.
    uint8 constant MAX_POSITION_UPDATES = 52; // Max iteration for updating position.

    // --------------------- Immutable storage ---------------------
    IMatchingEngine immutable _matchingEngine;
    address immutable _multiSig;
    IERC20 immutable _token;
    uint32 immutable _campaignDuration;
    uint32 immutable _accountingPeriod;

    // --------------------- Mutable storage ---------------------
    address _relayer;
    CampaignParameters _params;
    mapping(address => Vault) _vaults;
    mapping(uint64 => Campaign) _campaigns;
    mapping(bytes32 => Auction) _auctions;

    constructor(
        address multiSig_,
        address token_,
        address relayer_,
        uint32 campaignDuration_,
        uint32 accountingPeriod_,
        uint24 performanceFee_,
        uint24 minUtilizationRatio_,
        uint64 initialDeposit_
    ) {
        _matchingEngine = IMatchingEngine(msg.sender);
        _multiSig = multiSig_;
        _token = IERC20(token_);
        _relayer = relayer_;

        // Validate campaign parameters.
        if (campaignDuration_ < MIN_CAMPAIGN_DURATION) {
            revert ErrInvalidCampaignDuration();
        }
        if (accountingPeriod_ < MIN_ACCOUNTING_PERIOD) {
            revert ErrInvalidAccountingPeriod();
        }

        // Set campaign duration parameters.
        _campaignDuration = campaignDuration_;
        _accountingPeriod = accountingPeriod_;

        // Validate performance fee and max utilization ratio.
        if (performanceFee_ > MAX_BPS) {
            revert ErrInvalidPerformanceFee();
        } else if (minUtilizationRatio_ > MAX_BPS) {
            revert ErrInvalidMinUtilizationRatio();
        } else {
            _params.performanceFeeBps = performanceFee_;
            _params.minUtilizationRatioBps = minUtilizationRatio_;
            _params.currentCampaign = 0;
        }

        // Create relayer LP position.
        if (initialDeposit_ > 0) {
            _vaults[_relayer].amount[0] = initialDeposit_;
        } else {
            revert ErrInvalidDepositAmount(initialDeposit_);
        }
    }

    function _updateCampaignIndex() internal {
        unchecked {
            ++_params.currentCampaign;
        }
    }

    function currentCampaign() public view returns (uint64) {
        return _params.currentCampaign;
    }

    function relayer() external view returns (address) {
        return _relayer;
    }

    function token() external view returns (IERC20) {
        return _token;
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
