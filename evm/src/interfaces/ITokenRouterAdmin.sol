// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface ITokenRouterAdmin {
    function addRouterEndpoint(uint16 chain, bytes32 router) external;
}
