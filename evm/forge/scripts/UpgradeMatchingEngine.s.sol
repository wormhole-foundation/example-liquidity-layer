// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";

import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";
import {MatchingEngineImplementation} from
    "../../src/MatchingEngine/MatchingEngineImplementation.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

contract UpgradeMatchingEngine is CheckWormholeContracts, Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));
    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormhole = vm.envAddress("RELEASE_WORMHOLE_ADDRESS");
    address immutable _cctpTokenMessenger = vm.envAddress("RELEASE_TOKEN_MESSENGER_ADDRESS");
    address immutable _matchingEngineAddress = vm.envAddress("RELEASE_MATCHING_ENGINE_ADDRESS");

    // Auction parameters.
    uint24 immutable _userPenaltyRewardBps = uint24(vm.envUint("RELEASE_USER_REWARD_BPS"));
    uint24 immutable _initialPenaltyBps = uint24(vm.envUint("RELEASE_INIT_PENALTY_BPS"));
    uint8 immutable _auctionDuration = uint8(vm.envUint("RELEASE_AUCTION_DURATION"));
    uint8 immutable _auctionGracePeriod = uint8(vm.envUint("RELEASE_GRACE_PERIOD"));
    uint8 immutable _auctionPenaltyBlocks = uint8(vm.envUint("RELEASE_PENALTY_BLOCKS"));

    function upgrade() public {
        requireValidChain(_chainId, _wormhole);

        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _userPenaltyRewardBps,
            _initialPenaltyBps,
            _auctionDuration,
            _auctionGracePeriod,
            _auctionPenaltyBlocks
        );
        IMatchingEngine(_matchingEngineAddress).upgradeContract(address(implementation));
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Perform upgrade.
        upgrade();

        // Done.
        vm.stopBroadcast();
    }
}
