// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import "@openzeppelin/contracts/utils/Context.sol";

import {getOwnerState} from "../shared/Admin.sol";

contract OrderRouterSetup is ERC1967Upgrade, Context {
    function setup(address implementation) public {
        assert(implementation != address(0));

        // Set the owner, have to use context here since the proxy contract will
        // be the caller.
        getOwnerState().owner = _msgSender();

        // Set implementation.
        _upgradeTo(implementation);

        // Call initialize function of the new implementation.
        (bool success, bytes memory reason) = implementation.delegatecall(
            abi.encodeWithSignature("initialize()")
        );
        require(success, string(reason));
    }
}
