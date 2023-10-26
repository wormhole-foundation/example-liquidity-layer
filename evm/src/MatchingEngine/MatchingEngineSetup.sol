// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";

import {CurvePoolInfo, getCurvePoolState} from "./MatchingEngineStorage.sol";
import {getOwnerState, getOwnerAssistantState} from "../shared/Admin.sol";

contract MatchingEngineSetup is ERC1967Upgrade, Context {
    function setup(
        address implementation,
        address ownerAssistant,
        address nativeTokenAddress,
        int8 nativeTokenIndex
    ) public {
        assert(implementation != address(0));
        assert(ownerAssistant != address(0));
        assert(nativeTokenAddress != address(0));

        // Set the owner and owner assistant.
        getOwnerState().owner = _msgSender();
        getOwnerAssistantState().ownerAssistant = ownerAssistant;

        // Set the curve pool info.
        CurvePoolInfo storage curvePoolInfo = getCurvePoolState();
        curvePoolInfo.nativeTokenIndex = nativeTokenIndex;
        curvePoolInfo.nativeTokenAddress = nativeTokenAddress;

        // Set implementation.
        _upgradeTo(implementation);

        // Call initialize function of the new implementation.
        (bool success, bytes memory reason) = implementation.delegatecall(
            abi.encodeWithSignature("initialize()")
        );
        require(success, string(reason));
    }
}
