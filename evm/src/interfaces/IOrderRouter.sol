// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "./Types.sol";
import "./IPlaceMarketOrder.sol";
import "./IRedeemFill.sol";
import "./IRedeemOrderRevert.sol";

interface IOrderRouter is IPlaceMarketOrder, IRedeemFill, IRedeemOrderRevert {}
