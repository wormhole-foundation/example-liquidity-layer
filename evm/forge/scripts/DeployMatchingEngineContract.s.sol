// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MatchingEngine} from
    "src/MatchingEngine/MatchingEngine.sol";

import {CheckWormholeContracts} from "./helpers/CheckWormholeContracts.sol";

contract DeployMatchingEngineContracts is CheckWormholeContracts, Script {
    uint16 immutable _chainId = uint16(vm.envUint("RELEASE_CHAIN_ID"));

    address immutable _token = vm.envAddress("RELEASE_TOKEN_ADDRESS");
    address immutable _wormhole = vm.envAddress("RELEASE_WORMHOLE_ADDRESS");
    address immutable _cctpTokenMessenger = vm.envAddress("RELEASE_TOKEN_MESSENGER_ADDRESS");
    address immutable _ownerAssistantAddress = vm.envAddress("RELEASE_OWNER_ASSISTANT_ADDRESS");
    address immutable _feeRecipientAddress = vm.envAddress("RELEASE_FEE_RECIPIENT_ADDRESS");

    // Auction parameters.
    uint24 immutable _userPenaltyRewardBps = uint24(vm.envUint("RELEASE_USER_REWARD_BPS"));
    uint24 immutable _initialPenaltyBps = uint24(vm.envUint("RELEASE_INIT_PENALTY_BPS"));
    uint8 immutable _auctionDuration = uint8(vm.envUint("RELEASE_AUCTION_DURATION"));
    uint8 immutable _auctionGracePeriod = uint8(vm.envUint("RELEASE_GRACE_PERIOD"));
    uint8 immutable _auctionPenaltyBlocks = uint8(vm.envUint("RELEASE_PENALTY_BLOCKS"));

    function deployAndConfigure() public {
        requireValidChain(_chainId, _wormhole);

        MatchingEngine implementation = new MatchingEngine(
            _token,
            _wormhole,
            _cctpTokenMessenger,
            _userPenaltyRewardBps,
            _initialPenaltyBps,
            _auctionDuration,
            _auctionGracePeriod,
            _auctionPenaltyBlocks
        );

        MatchingEngine proxy =
            MatchingEngine(address(new ERC1967Proxy(address(implementation), "")));

        proxy.initialize();

        console2.log("Deployed MatchingEngine (chain=%s): %s", _chainId, address(proxy));

        // Set the owner assistant and fee recipient.
        proxy.updateOwnerAssistant(_ownerAssistantAddress);
        proxy.updateFeeRecipient(_feeRecipientAddress);
    }

    function run() public {
        // Begin sending transactions.
        vm.startBroadcast();

        // Deploy proxy and initialize.
        deployAndConfigure();

        // Done.
        vm.stopBroadcast();
    }
}
