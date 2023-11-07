// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Upgrade} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

import {getOwnerState, getOwnerAssistantState} from "../shared/Admin.sol";

import {IMatchingEngine} from "../interfaces/IMatchingEngine.sol";

import {MatchingEngineImplementation} from "../MatchingEngine/MatchingEngineImplementation.sol";

contract MatchingEngineSetup is ERC1967Upgrade, Context {
    error AlreadyDeployed();

    function deployProxy(address implementation, address ownerAssistant)
        public
        payable
        returns (address)
    {
        if (_getAdmin() != address(0)) {
            revert AlreadyDeployed();
        }

        _changeAdmin(_msgSender());

        ERC1967Proxy proxy = new ERC1967Proxy(
            address(this),
            abi.encodeCall(
                this.setup,
                (_getAdmin(), implementation, ownerAssistant)
            )
        );

        return address(proxy);
    }

    function setup(address admin, address implementation, address ownerAssistant) public {
        assert(implementation != address(0));
        assert(ownerAssistant != address(0));
        assert(IMatchingEngine(implementation).getDeployer() == admin);

        // Set the owner.
        getOwnerState().owner = admin;
        getOwnerAssistantState().ownerAssistant = ownerAssistant;

        // Set implementation.
        _upgradeTo(implementation);

        // Call initialize function of the new implementation.
        (bool success, bytes memory reason) =
            implementation.delegatecall(abi.encodeCall(MatchingEngineImplementation.initialize, ()));
        require(success, string(reason));
    }
}
