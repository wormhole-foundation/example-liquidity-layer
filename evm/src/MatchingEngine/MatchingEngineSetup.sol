// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";

import {CurvePoolInfo, getCurvePoolState} from "./MatchingEngineStorage.sol";
import {getOwnerState} from "../shared/Admin.sol";

contract MatchingEngineSetup is ERC1967Upgrade, Context {
    function setup(address implementation, address curve, int8 nativeTokenPoolIndex) public {
        assert(implementation != address(0));
        assert(curve != address(0));

        // Set the owner.
        getOwnerState().owner = _msgSender();

        // Set the Curve pool and native token index.
        CurvePoolInfo storage info = getCurvePoolState();
        info.pool = ICurvePool(curve);
        info.nativeTokenIndex = nativeTokenPoolIndex;

        // Set implementation.
        _upgradeTo(implementation);

        // Call initialize function of the new implementation.
        (bool success, bytes memory reason) = implementation.delegatecall(
            abi.encodeWithSignature("initialize()")
        );
        require(success, string(reason));
    }
}
