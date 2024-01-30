// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {IUSDC} from "cctp-solidity/IUSDC.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {SigningWormholeSimulator} from "wormhole-solidity/WormholeSimulator.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {
    IMockMatchingEngine,
    MockMatchingEngineImplementation
} from "./helpers/mock/MockMatchingEngineImplementation.sol";

import "../../src/MatchingEngine/assets/Errors.sol";
import {MatchingEngineImplementation} from
    "../../src/MatchingEngine/MatchingEngineImplementation.sol";
import {MatchingEngineSetup} from "../../src/MatchingEngine/MatchingEngineSetup.sol";

import "../../src/interfaces/ITokenRouterTypes.sol";
import {Messages} from "../../src/shared/Messages.sol";
import {Utils} from "../../src/shared/Utils.sol";

import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";
import {
    LiveAuctionData,
    AuctionStatus,
    CctpMessage,
    RouterEndpoint
} from "../../src/interfaces/IMatchingEngineTypes.sol";

import {FastTransferParameters} from "../../src/interfaces/ITokenRouterTypes.sol";
import {ITokenRouter} from "../../src/interfaces/ITokenRouter.sol";
import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";
import {TokenRouterSetup} from "../../src/TokenRouter/TokenRouterSetup.sol";
import {RedeemedFill} from "../../src/interfaces/IRedeemFill.sol";

import {WormholeCctpMessages} from "../../src/shared/WormholeCctpMessages.sol";

contract MatchingEngineTest is Test {
    using Messages for *;
    using Utils for *;
    using WormholeCctpMessages for *;

    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;
    address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
    uint16 constant ARB_CHAIN = 23;
    uint16 constant AVAX_CHAIN = 6;
    uint16 constant ETH_CHAIN = 2;
    uint32 constant ARB_DOMAIN = 3;
    uint32 constant ETH_DOMAIN = 0;

    // Environment variables.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    bytes32 immutable CIRCLE_BRIDGE = vm.envAddress("AVAX_CIRCLE_BRIDGE").toUniversalAddress();
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");
    IWormhole immutable wormhole = IWormhole(vm.envAddress("AVAX_WORMHOLE"));

    bytes32 immutable FOREIGN_CIRCLE_BRIDGE =
        vm.envAddress("ARB_CIRCLE_BRIDGE").toUniversalAddress();

    uint32 immutable ENGINE_DOMAIN = 1;

    bytes32 immutable TEST_REDEEMER = makeAddr("TEST_REDEEMER").toUniversalAddress();

    // Used to calculate a theo price for the fast transfer fee.
    uint64 immutable TEST_TRANSFER_FEE_IN_BPS = 25000; // 0.25%.

    // Fast transfer outbound parameters.
    uint64 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint64 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint64 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Initial Auction parameters.
    uint24 immutable USER_PENALTY_REWARD_BPS = 250000; // 25%.
    uint24 immutable INITIAL_PENALTY_BPS = 100000; // 10%.
    uint8 immutable AUCTION_DURATION = 2; // Two blocks ~6 seconds.
    uint8 immutable AUCTION_GRACE_PERIOD = 6; // Includes the auction duration.
    uint8 immutable AUCTION_PENALTY_BLOCKS = 20;

    // Test router endpoints.
    bytes32 immutable ETH_ROUTER = makeAddr("ETH_ROUTER").toUniversalAddress();
    bytes32 immutable ARB_ROUTER = makeAddr("ARB_ROUTER").toUniversalAddress();

    // Players.
    address immutable PLAYER_ONE = makeAddr("player one");
    address immutable PLAYER_TWO = makeAddr("player two");
    address immutable PLAYER_THREE = makeAddr("player three");
    address immutable RELAYER = makeAddr("relayer");
    address immutable FEE_RECIPIENT = makeAddr("feeRecipient");

    // Test engines.
    IMatchingEngine engine;

    // Integrating contract helpers.
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;

    function deployProxy(address _token, address _wormhole, address _tokenMessenger)
        internal
        returns (IMatchingEngine)
    {
        // Deploy Implementation.
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _token,
            _wormhole,
            _tokenMessenger,
            USER_PENALTY_REWARD_BPS,
            INITIAL_PENALTY_BPS,
            AUCTION_DURATION,
            AUCTION_GRACE_PERIOD,
            AUCTION_PENALTY_BLOCKS
        );

        // Deploy Setup.
        MatchingEngineSetup setup = new MatchingEngineSetup();

        address proxy =
            setup.deployProxy(address(implementation), makeAddr("ownerAssistant"), FEE_RECIPIENT);

        return IMatchingEngine(proxy);
    }

    function setUp() public {
        vm.startPrank(makeAddr("owner"));
        engine = deployProxy(USDC_ADDRESS, address(wormhole), CIRCLE_BRIDGE.fromUniversalAddress());

        // Set the allowance to the max.
        engine.setCctpAllowance(type(uint256).max);

        // Set up the router endpoints.
        engine.addRouterEndpoint(
            ARB_CHAIN, RouterEndpoint({router: ARB_ROUTER, mintRecipient: ARB_ROUTER})
        );
        engine.addRouterEndpoint(
            ETH_CHAIN, RouterEndpoint({router: ETH_ROUTER, mintRecipient: ETH_ROUTER})
        );

        vm.stopPrank();

        wormholeSimulator = new SigningWormholeSimulator(wormhole, TESTING_SIGNER);

        circleSimulator = new CircleSimulator(TESTING_SIGNER, MESSAGE_TRANSMITTER);
        circleSimulator.setupCircleAttester();
    }

    /**
     * ADMIN TESTS
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            USER_PENALTY_REWARD_BPS,
            INITIAL_PENALTY_BPS,
            AUCTION_DURATION,
            AUCTION_GRACE_PERIOD,
            AUCTION_PENALTY_BLOCKS
        );

        // Upgrade the contract.
        vm.prank(makeAddr("owner"));
        engine.upgradeContract(address(newImplementation));

        // Use mock implementation interface.
        IMockMatchingEngine mockEngine = IMockMatchingEngine(address(engine));

        // Verify the new implementation.
        assertEq(mockEngine.getImplementation(), address(newImplementation));
        assertTrue(mockEngine.isUpgraded());
    }

    function testCannotUpgradeContractAgain() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            USER_PENALTY_REWARD_BPS,
            INITIAL_PENALTY_BPS,
            AUCTION_DURATION,
            AUCTION_GRACE_PERIOD,
            AUCTION_PENALTY_BLOCKS
        );

        vm.startPrank(makeAddr("owner"));

        // Upgrade the contract.
        engine.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        engine.upgradeContract(address(newImplementation));
    }

    function testCannotUpgradeContractInvalidAuctionDuration() public {
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidAuctionDuration()"));
        new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            USER_PENALTY_REWARD_BPS,
            INITIAL_PENALTY_BPS,
            0, // Set the auction duration to zero.
            AUCTION_GRACE_PERIOD,
            AUCTION_PENALTY_BLOCKS
        );
    }

    function testCannotUpgradeContractInvalidGracePeriod() public {
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidAuctionGracePeriod()"));
        new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            USER_PENALTY_REWARD_BPS,
            INITIAL_PENALTY_BPS,
            AUCTION_DURATION,
            AUCTION_DURATION, // Set the grace period to the same as the duration.
            AUCTION_PENALTY_BLOCKS
        );
    }

    function revertTestHack(uint24 userPenaltyRewardBps, uint24 initialPenaltyBps) external {
        new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            userPenaltyRewardBps,
            initialPenaltyBps,
            AUCTION_DURATION,
            AUCTION_GRACE_PERIOD,
            AUCTION_PENALTY_BLOCKS
        );
    }

    function testCannotUpgradeContractInvalidUserPenaltyReward() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "revertTestHack(uint24,uint24)", engine.maxBpsFee() + 1, INITIAL_PENALTY_BPS
        );
        expectRevert(
            address(this),
            encodedSignature,
            abi.encodeWithSignature("ErrInvalidUserPenaltyRewardBps()")
        );
    }

    function testCannotUpgradeContractInvalidInitialPenalty() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "revertTestHack(uint24,uint24)", USER_PENALTY_REWARD_BPS, engine.maxBpsFee() + 1
        );
        expectRevert(
            address(this),
            encodedSignature,
            abi.encodeWithSignature("ErrInvalidInitialPenaltyBps()")
        );
    }

    function testCannotUpgradeContractInvalidAddress() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.upgradeContract(address(0));
    }

    function testCannotUpgradeContractOwnerOnly() public {
        vm.prank(makeAddr("not owner"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        engine.upgradeContract(address(makeAddr("newImplementation")));
    }

    function testAddRouterEndpoint() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        bytes32 mintRecipient = makeAddr("newRouter").toUniversalAddress();

        assertEq(engine.getRouter(chain), bytes32(0));
        assertEq(engine.getMintRecipient(chain), bytes32(0));

        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(
            chain, RouterEndpoint({router: routerEndpoint, mintRecipient: mintRecipient})
        );

        assertEq(engine.getRouter(chain), routerEndpoint);
        assertEq(engine.getMintRecipient(chain), mintRecipient);
    }

    function testCannotAddRouterEndpointChainIdZero() public {
        uint16 chain = 0;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        bytes32 mintRecipient = makeAddr("newRouter").toUniversalAddress();

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        engine.addRouterEndpoint(
            chain, RouterEndpoint({router: routerEndpoint, mintRecipient: mintRecipient})
        );
    }

    function testCannotAddRouterEndpointInvalidRouter() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = bytes32(0);
        bytes32 mintRecipient = makeAddr("newRouter").toUniversalAddress();

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEndpoint(bytes32)", routerEndpoint));
        engine.addRouterEndpoint(
            chain, RouterEndpoint({router: routerEndpoint, mintRecipient: mintRecipient})
        );
    }

    function testCannotAddRouterEndpointInvalidMintRecipient() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        bytes32 mintRecipient = bytes32(0);

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEndpoint(bytes32)", mintRecipient));
        engine.addRouterEndpoint(
            chain, RouterEndpoint({router: routerEndpoint, mintRecipient: mintRecipient})
        );
    }

    function testCannotAddRouterEndpointOwnerOrAssistantOnly() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        bytes32 mintRecipient = makeAddr("newRouter").toUniversalAddress();

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.addRouterEndpoint(
            chain, RouterEndpoint({router: routerEndpoint, mintRecipient: mintRecipient})
        );
    }

    function testUpdateFeeRecipient() public {
        assertEq(engine.feeRecipient(), FEE_RECIPIENT);

        vm.prank(makeAddr("owner"));
        engine.updateFeeRecipient(PLAYER_ONE);

        assertEq(engine.feeRecipient(), PLAYER_ONE);
    }

    function testCannotUpdateFeeRecipientInvalidAddress() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        engine.updateFeeRecipient(address(0));
    }

    function testCannotUpdateFeeRecipientOnlyOwnerOrAssistant() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.updateFeeRecipient(PLAYER_ONE);
    }

    function testSetCctpAllowance() public {
        uint256 allowance = 420;

        assertEq(
            IERC20(USDC_ADDRESS).allowance(address(engine), CIRCLE_BRIDGE.fromUniversalAddress()),
            type(uint256).max
        );

        vm.prank(makeAddr("owner"));
        engine.setCctpAllowance(allowance);

        assertEq(
            IERC20(USDC_ADDRESS).allowance(address(engine), CIRCLE_BRIDGE.fromUniversalAddress()),
            allowance
        );
    }

    function testCannotSetCctpAllowanceOnlyOwnerOrAssistant() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.setCctpAllowance(0);
    }

    /**
     * AUCTION TESTS
     */

    function testCalculateDynamicPenalty() public {
        // Still in grace period.
        {
            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() - 1);
            assertEq(penalty, 0);
            assertEq(reward, 0);
        }

        // Penalty period is over.
        {
            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) = engine.calculateDynamicPenalty(
                amount, engine.getAuctionPenaltyBlocks() + engine.getAuctionGracePeriod()
            );
            assertEq(penalty, 7500000);
            assertEq(reward, 2500000);
        }

        // One block into the penalty period.
        {
            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 1);
            assertEq(penalty, 1087500);
            assertEq(reward, 362500);
        }

        // 50% of the way through the penalty period.
        {
            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 4125000);
            assertEq(reward, 1375000);
        }

        // Penalty period boundary (19/20)
        {
            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 19);
            assertEq(penalty, 7162500);
            assertEq(reward, 2387500);
        }

        // Update the initial penalty to 0%. 50% of the way through the penalty period.
        {
            _upgradeWithNewAuctionParams(
                engine.getUserPenaltyRewardBps(),
                uint24(0),
                engine.getAuctionDuration(),
                engine.getAuctionGracePeriod(),
                engine.getAuctionPenaltyBlocks()
            );

            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 3750000);
            assertEq(reward, 1250000);
        }

        // Set the user reward to 0%
        {
            _upgradeWithNewAuctionParams(
                0,
                0, // 0% initial penalty.
                engine.getAuctionDuration(),
                engine.getAuctionGracePeriod(),
                engine.getAuctionPenaltyBlocks()
            );

            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 5000000);
            assertEq(reward, 0);
        }

        // Set the initial penalty to 100%
        {
            _upgradeWithNewAuctionParams(
                engine.maxBpsFee() / 2, // 50%
                engine.maxBpsFee(), // 100%
                engine.getAuctionDuration(),
                engine.getAuctionGracePeriod(),
                engine.getAuctionPenaltyBlocks()
            );

            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 5);
            assertEq(penalty, 5000000);
            assertEq(reward, 5000000);
        }

        // Set the user penalty to 100%
        {
            _upgradeWithNewAuctionParams(
                engine.maxBpsFee(), // 100%
                engine.maxBpsFee() / 2, // 50%
                engine.getAuctionDuration(),
                engine.getAuctionGracePeriod(),
                engine.getAuctionPenaltyBlocks()
            );

            uint64 amount = 10000000;
            (uint64 penalty, uint64 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 0);
            assertEq(reward, 7500000);
        }
    }

    /**
     * PLACE INITIAL BID TESTS
     */

    function testPlaceInitialBid(uint64 amountIn, uint64 feeBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        // This method explicitly sets the deadline to zero.
        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Cap the fee bid.
        feeBid = uint64(bound(feeBid, 0, order.maxFee));

        // Place initial bid with player one and verify the state changes.
        _placeInitialBid(order, fastMessage, feeBid, PLAYER_ONE);
    }

    function testPlaceInitialBidWithDeadline(uint64 amountIn, uint64 feeBid, uint32 timeToDeadline)
        public
    {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));
        timeToDeadline =
            uint32(bound(timeToDeadline, 5, type(uint32).max - uint32(block.timestamp)));
        uint32 deadline = uint32(block.timestamp + timeToDeadline);

        // This method explicitly sets the deadline to zero.
        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, deadline);

        // Cap the fee bid.
        feeBid = uint64(bound(feeBid, 0, order.maxFee));

        // Place initial bid with player one and verify the state changes.
        _placeInitialBid(order, fastMessage, feeBid, PLAYER_ONE);
    }

    function testCannotPlaceInitialBidDeadlineExceeded() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint64 transferFee = _calculateFastTransferFee(amountIn);
        uint32 deadline = uint32(block.timestamp) + 10;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: transferFee,
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: uint32(block.timestamp + 1),
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Use an emitter chain that is not registered.
        bytes memory fastMessage = _createSignedVaa(ARB_CHAIN, ARB_ROUTER, 0, order.encode());

        // Test the deadline by warping the timestamp.
        vm.warp(deadline + 1);

        vm.expectRevert(abi.encodeWithSignature("ErrDeadlineExceeded()"));
        engine.placeInitialBid(fastMessage, transferFee);
    }

    function testCannotPlaceInitialBidInvalidWormholeMessage() public {
        (, bytes memory fastMessage) = _getFastMarketOrder(_getMinTransferAmount());

        // Modify the vaa.
        fastMessage[5] = 0x00;

        vm.expectRevert(abi.encodeWithSignature("ErrInvalidWormholeMessage(string)", "no quorum"));
        engine.placeInitialBid(fastMessage, 69);
    }

    function testCannotPlaceInitialBidInvalidRouterPath() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint64 bid = 420;
        uint16 invalidChain = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Use an emitter chain that is not registered.
        bytes memory fastMessage = _createSignedVaa(invalidChain, ARB_ROUTER, 0, order.encode());

        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidSourceRouter(bytes32,bytes32)", ARB_ROUTER, bytes32(0)
            )
        );
        engine.placeInitialBid(fastMessage, bid);
    }

    function testCannotPlaceInitialBidInvalidTargetRouter() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint64 bid = 420;
        uint16 invalidChain = 69;

        // Use an invalid target chain.
        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: invalidChain,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Use an emitter chain that is not registered.
        bytes memory fastMessage = _createSignedVaa(ARB_CHAIN, ARB_ROUTER, 0, order.encode());

        vm.expectRevert(abi.encodeWithSignature("ErrInvalidTargetRouter(uint16)", invalidChain));
        engine.placeInitialBid(fastMessage, bid);
    }

    function testCannotPlaceInitialBidPriceTooHigh() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint64 transferFee = _calculateFastTransferFee(amountIn);

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: transferFee,
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Use an emitter chain that is not registered.
        bytes memory fastMessage = _createSignedVaa(ARB_CHAIN, ARB_ROUTER, 0, order.encode());

        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrBidPriceTooHigh(uint64,uint64)", transferFee + 1, transferFee
            )
        );
        engine.placeInitialBid(fastMessage, transferFee + 1);
    }

    function testCannotPlaceInitialBidAuctionNotActive() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        // Complete a successful auction.
        {
            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            _executeFastOrder(fastMessage, PLAYER_ONE);
        }

        // Attempt to place a bid on a completed auction.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionNotActive(bytes32)", auctionId));
        engine.placeInitialBid(fastMessage, order.maxFee);
    }

    /**
     * @notice This test demonstrates how the contract does not revert if
     * two players are racing to place the initial bid. Instead, `_improveBid`
     * is called and the highest bidder is updated.
     */
    function testPlaceInitialBidAgain(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint64(bound(newBid, 0, order.maxFee));

        _dealAndApproveUsdc(engine, order.amountIn + order.maxFee, PLAYER_TWO);

        uint256 newBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);
        uint256 oldBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        // Call `placeInitialBid` as player two.
        vm.prank(PLAYER_TWO);
        engine.placeInitialBid(fastMessage, newBid);

        assertEq(
            newBalanceBefore - IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO),
            order.amountIn + order.maxFee
        );
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - oldBalanceBefore,
            order.amountIn + order.maxFee
        );

        // Validate state and balance changes.
        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        _verifyAuctionState(order, newBid, PLAYER_TWO, PLAYER_ONE, _vm.hash);
    }

    /**
     * IMPROVE BID TESTS
     */

    function testImproveBid(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint64(bound(newBid, 0, order.maxFee));

        _improveBid(order, fastMessage, newBid, PLAYER_ONE, PLAYER_TWO);
    }

    function testImproveBidWithHighestBidder(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint64(bound(newBid, 0, order.maxFee));

        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        // Improve the bid with player one, so we're basically modifying
        // the existing bid.
        vm.prank(PLAYER_ONE);
        engine.improveBid(_vm.hash, newBid);

        assertEq(balanceBefore, IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE));

        _verifyAuctionState(order, newBid, PLAYER_ONE, PLAYER_ONE, _vm.hash);
    }

    function testCannotImproveBidAuctionAlreadyCompleted() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        // Complete a successful auction.
        {
            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            _executeFastOrder(fastMessage, PLAYER_ONE);
        }

        // Attempt to improve a bid on a completed auction.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionNotActive(bytes32)", auctionId));
        engine.improveBid(auctionId, order.maxFee - 1);
    }

    function testCannotImproveBidAuctionNotActive() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        // Attempt to improve a bid on an auction that hasn't started.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionNotActive(bytes32)", auctionId));
        engine.improveBid(auctionId, order.maxFee - 1);
    }

    function testCannotImproveBidAuctionExpired() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Warp the block into the grace period.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);

        // Attempt to improve a bid on an auction that has expired.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionPeriodExpired()"));
        engine.improveBid(auctionId, order.maxFee - 1);
    }

    function testCannotImproveBidPriceTooHigh() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Try to place a bid with the same price.
        vm.expectRevert(
            abi.encodeWithSignature("ErrBidPriceTooHigh(uint64,uint64)", order.maxFee, order.maxFee)
        );
        engine.improveBid(auctionId, order.maxFee);
    }

    /**
     * EXECUTE FAST ORDER TESTS
     */

    function testExecuteFastOrder(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint64(bound(newBid, 0, order.maxFee));
        _improveBid(order, fastMessage, newBid, PLAYER_ONE, PLAYER_TWO);

        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        // Warp the block into the grace period.
        vm.roll(engine.liveAuctionInfo(_vm.hash).startBlock + engine.getAuctionDuration() + 1);

        // Execute the fast order. The highest bidder should receive the security deposit,
        // plus the agreed upon fee back. The initial bidder should receive the init fee.
        uint256 highBidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);
        uint256 initialBidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        IWormhole.VM memory cctpMessage = _executeFastOrder(fastMessage, PLAYER_TWO);

        _verifyOutboundCctpTransfer(
            order, amountIn - newBid - FAST_TRANSFER_INIT_AUCTION_FEE, cctpMessage, PLAYER_TWO
        );

        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - highBidderBefore, order.maxFee + newBid
        );
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - initialBidderBefore,
            FAST_TRANSFER_INIT_AUCTION_FEE
        );
        assertEq(uint8(engine.getAuctionStatus(_vm.hash)), uint8(AuctionStatus.Completed));
    }

    function testExecuteFastOrderWithPenalty(uint64 amountIn, uint8 penaltyBlocks) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Place initial bid for the max fee with player one.
        uint64 bidPrice = order.maxFee - 1;
        _placeInitialBid(order, fastMessage, bidPrice, PLAYER_ONE);

        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        // Warp the block into the penalty period.
        penaltyBlocks = uint8(bound(penaltyBlocks, 1, engine.getAuctionPenaltyBlocks() + 1));
        uint64 startBlock = engine.liveAuctionInfo(_vm.hash).startBlock;
        vm.roll(startBlock + engine.getAuctionGracePeriod() + penaltyBlocks);

        // Calculate the expected penalty and reward.
        (uint64 expectedPenalty, uint64 expectedReward) =
            engine.calculateDynamicPenalty(order.maxFee, uint64(block.number - startBlock));

        // Execute the fast order, the highest bidder should receive some of their security deposit
        // (less penalties).
        uint256 bidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);
        uint256 liquidatorBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        // Execute the fast order using the "liquidator".
        IWormhole.VM memory cctpMessage = _executeFastOrder(fastMessage, PLAYER_TWO);

        _verifyOutboundCctpTransfer(
            order,
            amountIn - bidPrice - FAST_TRANSFER_INIT_AUCTION_FEE + expectedReward,
            cctpMessage,
            PLAYER_TWO
        );

        // PLAYER_ONE also gets the init fee for creating the auction.
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - bidderBefore,
            bidPrice + order.maxFee - (expectedPenalty + expectedReward)
                + FAST_TRANSFER_INIT_AUCTION_FEE
        );
        assertEq(IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - liquidatorBefore, expectedPenalty);
        assertEq(uint8(engine.getAuctionStatus(_vm.hash)), uint8(AuctionStatus.Completed));
    }

    function testCannotExecuteFastOrderAuctionNotActive() public {
        uint64 amountIn = _getMinTransferAmount() + 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        // Complete a successful auction.
        {
            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            _executeFastOrder(fastMessage, PLAYER_ONE);
        }

        // Attempt to execute the fast order on a completed auction.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionNotActive(bytes32)", auctionId));
        engine.executeFastOrder(fastMessage);
    }

    function testCannotExecuteFastOrderAuctionPeriodNotComplete() public {
        uint64 amountIn = _getMinTransferAmount() + 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // NOTE: We skip rolling the block number on purpose.

        // Attempt to execute the fast order on a completed auction.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionPeriodNotComplete()"));
        engine.executeFastOrder(fastMessage);
    }

    function testCannotExecuteFastOrderAuctionInvalidWormholeMessage() public {
        uint64 amountIn = _getMinTransferAmount() + 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);

        // Modify the vaa.
        fastMessage[5] = 0x00;

        vm.expectRevert(abi.encodeWithSignature("ErrInvalidWormholeMessage(string)", "no quorum"));
        engine.executeFastOrder(fastMessage);
    }

    /**
     * SLOW ORDER TESTS
     */

    function testExecuteSlowOrderAndRedeem(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint64(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        IWormhole.VM memory vaa = wormhole.parseVM(fastMessage);
        bytes32 auctionId = vaa.hash;
        uint64 fastSequence = vaa.sequence;

        // Warp the block into the grace period and execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        _executeFastOrder(fastMessage, PLAYER_TWO);

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        // Execute the slow order, the highest bidder should receive their initial deposit.
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        vm.prank(PLAYER_TWO);
        engine.executeSlowOrderAndRedeem(fastMessage, params);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - balanceBefore, order.amountIn);
    }

    function testExecuteSlowOrderAndRedeemAuctionNotStarted(uint64 amountIn) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // NOTE: We skip starting the auction on purpose.

        IWormhole.VM memory vaa = wormhole.parseVM(fastMessage);
        bytes32 auctionId = vaa.hash;
        uint64 fastSequence = vaa.sequence;

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        // Execute the slow order, the highest bidder should receive their initial deposit.
        // The fee recipient should receive the base fee, even though the caller isn't
        // the same address.
        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 feeRecipientBefore = IERC20(USDC_ADDRESS).balanceOf(FEE_RECIPIENT);
        uint256 contractBefore = IERC20(USDC_ADDRESS).balanceOf(address(engine));

        // Since the auction was never started, the relayer should receive the base fee,
        // and the contract's balance shouldn't change (no funds were custodied).
        IWormhole.VM memory cctpMessage = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(order, amountIn - FAST_TRANSFER_BASE_FEE, cctpMessage, RELAYER);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(RELAYER) - relayerBefore, 0);
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(FEE_RECIPIENT) - feeRecipientBefore,
            FAST_TRANSFER_BASE_FEE
        );
        assertEq(IERC20(USDC_ADDRESS).balanceOf(address(engine)), contractBefore);
        assertEq(uint8(engine.getAuctionStatus(auctionId)), uint8(AuctionStatus.Completed));
    }

    function testExecuteSlowOrderAndRedeemAuctionStillActive(uint64 amountIn, uint64 newBid)
        public
    {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Cache security deposit for later use.
        uint64 securityDeposit = order.maxFee;

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint64(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        IWormhole.VM memory vaa = wormhole.parseVM(fastMessage);
        bytes32 auctionId = vaa.hash;
        uint64 fastSequence = vaa.sequence;

        // Warp the block into the grace period and execute the fast order, but DO NOT
        // execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 playerBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        IWormhole.VM memory cctpMessage = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(order, amountIn - FAST_TRANSFER_BASE_FEE, cctpMessage, RELAYER);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(RELAYER) - relayerBefore, FAST_TRANSFER_BASE_FEE);
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - playerBefore,
            order.amountIn + securityDeposit
        );
    }

    function testExecuteSlowOrderAndRedeemAuctionStillActiveWithPenalty(
        uint64 amountIn,
        uint8 penaltyBlocks
    ) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // Cache security deposit for later use.
        uint256 securityDeposit = order.maxFee;

        // Place initial bid for the max fee with player one.
        uint64 bidPrice = order.maxFee - 1;
        _placeInitialBid(order, fastMessage, bidPrice, PLAYER_ONE);

        IWormhole.VM memory vaa = wormhole.parseVM(fastMessage);
        bytes32 auctionId = vaa.hash;
        uint64 fastSequence = vaa.sequence;

        // Warp the block into the penalty period.
        penaltyBlocks = uint8(bound(penaltyBlocks, 1, engine.getAuctionPenaltyBlocks() + 1));
        uint64 startBlock = engine.liveAuctionInfo(auctionId).startBlock;
        vm.roll(startBlock + engine.getAuctionGracePeriod() + penaltyBlocks);

        // Calculate the expected penalty and reward.
        (uint64 expectedPenalty, uint64 expectedReward) =
            engine.calculateDynamicPenalty(order.maxFee, uint64(block.number - startBlock));

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 playerBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        IWormhole.VM memory cctpMessage = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(
            order, amountIn - FAST_TRANSFER_BASE_FEE + expectedReward, cctpMessage, RELAYER
        );

        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(RELAYER) - relayerBefore,
            FAST_TRANSFER_BASE_FEE + expectedPenalty
        );
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - playerBefore,
            order.amountIn + securityDeposit - (expectedPenalty + expectedReward)
        );
    }

    function testCannotExecuteSlowOrderAndRedeemInvalidSourceRouterNoAuction() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint64 fastSequence = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });
        bytes memory fastMessage =
            _createSignedVaa(ARB_CHAIN, ARB_ROUTER, fastSequence, order.encode());

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        // Change the address for the arb router.
        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(
            ARB_CHAIN,
            RouterEndpoint({router: bytes32("deadbeef"), mintRecipient: bytes32("beefdead")})
        );

        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidSourceRouter(bytes32,bytes32)", ARB_ROUTER, bytes32("deadbeef")
            )
        );
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemWithRolledBackVaa(uint64 amountIn) public {
        uint32 timestampOne = 69;
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        // Create two fast orders with the same sequence, but different timestamps to simulate
        // a rolled back VAA. The fast message that doesn't have a specified timestamp arg
        // will use the default 1234567, which is also assigned to the slow VAA.
        (, bytes memory rolledBackMessage) =
            _getFastMarketOrder(amountIn, ETH_CHAIN, ETH_DOMAIN, 0, timestampOne);
        (Messages.FastMarketOrder memory order,) = _getFastMarketOrder(amountIn, 0);

        // Start the auction and make some bids.
        _placeInitialBid(order, rolledBackMessage, order.maxFee, PLAYER_ONE);

        IWormhole.VM memory vaa = wormhole.parseVM(rolledBackMessage);
        bytes32 auctionId = vaa.hash;
        uint64 fastSequence = vaa.sequence;

        // Warp the block into the grace period and execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        _executeFastOrder(rolledBackMessage, PLAYER_TWO);

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        vm.prank(PLAYER_TWO);
        engine.executeSlowOrderAndRedeem(rolledBackMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemInvalidTargetRouter() public {
        uint64 amountIn = _getMinTransferAmount() + 6900;
        uint16 invalidTargetChain = 69;
        uint64 fastSequence = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: invalidTargetChain,
            targetDomain: ETH_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });
        bytes memory fastMessage =
            _createSignedVaa(ARB_CHAIN, ARB_ROUTER, fastSequence, order.encode());

        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            fastSequence - 1
        );

        vm.expectRevert(
            abi.encodeWithSignature("ErrInvalidTargetRouter(uint16)", invalidTargetChain)
        );
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchCompletedAuction() public {
        uint64 fastSequence = 69;
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        _executeFastOrder(fastMessage, PLAYER_TWO);

        // NOTE: Create slow VAA with a different sequence number.
        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            order.encode(),
            fastSequence - 2 // Subtract 2 to make it invalid.
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchActiveAuction() public {
        uint64 fastSequence = 69;
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);
        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        // Do not execute the fast order.

        // NOTE: Create slow VAA with a different sequence number.
        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            order.encode(),
            fastSequence - 2 // Subtract 2 to make it invalid.
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchAuctionNotStarted() public {
        uint64 fastSequence = 69;
        uint64 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn);

        // NOTE: Create slow VAA with a different sequence number.
        CctpMessage memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            order.encode(),
            fastSequence - 2 // Subtract 2 to make it invalid.
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    /**
     * FAST FILL TESTS
     */

    function testRedeemFastFill(uint64 amountIn, uint64 newBid) public {
        amountIn = uint64(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint64(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

        // Warp the block into the grace period and execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        bytes memory fastFill =
            _executeFastOrderWithSignedBytes(fastMessage, PLAYER_TWO, AVAX_CHAIN, address(engine));

        address testRedeemer = TEST_REDEEMER.fromUniversalAddress();
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(testRedeemer);

        vm.prank(testRedeemer);
        RedeemedFill memory fill = avaxRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: fastFill,
                circleBridgeMessage: bytes(""),
                circleAttestation: bytes("")
            })
        );

        // Amount that the fill should yield.
        uint256 expectedFillAmount = order.amountIn - engine.liveAuctionInfo(auctionId).bidPrice
            - FAST_TRANSFER_INIT_AUCTION_FEE;

        assertEq(IERC20(USDC_ADDRESS).balanceOf(testRedeemer) - balanceBefore, expectedFillAmount);
        assertEq(fill.sender, address(this).toUniversalAddress());
        assertEq(fill.senderChain, ARB_CHAIN);
        assertEq(fill.token, address(USDC_ADDRESS));
        assertEq(fill.amount, expectedFillAmount);
        assertEq(fill.message, order.redeemerMessage);
    }

    function testCannotRedeemFastFillInvalidEmitterChain() public {
        uint64 amountIn = _getMinTransferAmount() + 69;
        uint16 invalidEmitterChain = 69;

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);
            bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrderWithSignedBytes(
                fastMessage, PLAYER_ONE, invalidEmitterChain, address(engine)
            );
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(address(avaxRouter));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEmitterForFastFill()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidEmitterAddress() public {
        uint64 amountIn = _getMinTransferAmount() + 69;
        address invalidEmitterAddress = makeAddr("invalidEmitter");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);
            bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrderWithSignedBytes(
                fastMessage, PLAYER_ONE, AVAX_CHAIN, invalidEmitterAddress
            );
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(address(avaxRouter));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEmitterForFastFill()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidSourceRouter() public {
        uint64 amountIn = _getMinTransferAmount() + 69;
        address invalidRouter = makeAddr("invalidRouter");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);
            bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrderWithSignedBytes(
                fastMessage, PLAYER_ONE, AVAX_CHAIN, address(engine)
            );
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(invalidRouter);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidSourceRouter(bytes32,bytes32)",
                invalidRouter.toUniversalAddress(),
                address(avaxRouter).toUniversalAddress()
            )
        );
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillAgain() public {
        uint64 amountIn = _getMinTransferAmount() + 69;

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);
            bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrderWithSignedBytes(
                fastMessage, PLAYER_ONE, AVAX_CHAIN, address(engine)
            );
        }

        // Successfull redeem the fill.
        vm.startPrank(address(avaxRouter));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);

        // Now try again.
        vm.expectRevert(abi.encodeWithSignature("ErrFastFillAlreadyRedeemed()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidRedeemer() public {
        uint64 amountIn = _getMinTransferAmount() + 69420;
        address invalidRedeemer = makeAddr("invalidRedeemer");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, AVAX_CHAIN, ENGINE_DOMAIN, 0);
            bytes32 auctionId = wormhole.parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrderWithSignedBytes(
                fastMessage, PLAYER_ONE, AVAX_CHAIN, address(engine)
            );
        }

        vm.prank(invalidRedeemer);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidRedeemer(bytes32,bytes32)",
                invalidRedeemer.toUniversalAddress(),
                TEST_REDEEMER
            )
        );
        avaxRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: fastFill,
                circleBridgeMessage: bytes(""),
                circleAttestation: bytes("")
            })
        );
    }

    /**
     * TEST HELPERS
     */

    function _deployAndRegisterAvaxRouter() internal returns (ITokenRouter) {
        // Deploy Implementation.
        TokenRouterImplementation implementation = new TokenRouterImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            AVAX_CHAIN,
            address(engine).toUniversalAddress(),
            address(engine).toUniversalAddress(),
            ENGINE_DOMAIN
        );

        // Deploy Setup.
        TokenRouterSetup setup = new TokenRouterSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(
            AVAX_CHAIN,
            RouterEndpoint({
                router: proxy.toUniversalAddress(),
                mintRecipient: proxy.toUniversalAddress()
            })
        );

        return ITokenRouter(proxy);
    }

    function _placeInitialBid(
        Messages.FastMarketOrder memory order,
        bytes memory fastMessage,
        uint64 feeBid,
        address bidder
    ) internal {
        _dealAndApproveUsdc(engine, order.amountIn + order.maxFee, bidder);

        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(bidder);

        // Place the initial bid as player one.
        vm.prank(bidder);
        engine.placeInitialBid(fastMessage, feeBid);

        // Validate state and balance changes.
        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        assertEq(
            balanceBefore - IERC20(USDC_ADDRESS).balanceOf(bidder), order.amountIn + order.maxFee
        );

        _verifyAuctionState(order, feeBid, bidder, bidder, _vm.hash);
    }

    function _improveBid(
        Messages.FastMarketOrder memory order,
        bytes memory fastMessage,
        uint64 newBid,
        address initialBidder,
        address newBidder
    ) internal {
        _dealAndApproveUsdc(engine, order.amountIn + order.maxFee, newBidder);

        uint256 newBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(newBidder);
        uint256 oldBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(initialBidder);

        // Validate state and balance changes.
        IWormhole.VM memory _vm = wormhole.parseVM(fastMessage);

        // Place the initial bid as `newBidder`.
        vm.prank(newBidder);
        engine.improveBid(_vm.hash, newBid);

        assertEq(
            newBalanceBefore - IERC20(USDC_ADDRESS).balanceOf(newBidder),
            order.amountIn + order.maxFee
        );
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(initialBidder) - oldBalanceBefore,
            order.amountIn + order.maxFee
        );

        _verifyAuctionState(order, newBid, newBidder, initialBidder, _vm.hash);
    }

    function _executeFastOrder(bytes memory fastMessage, address caller)
        internal
        returns (IWormhole.VM memory message)
    {
        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        vm.prank(caller);
        engine.executeFastOrder(fastMessage);

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        message = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        );
    }

    function _executeFastOrderWithSignedBytes(
        bytes memory fastMessage,
        address caller,
        uint16 emitterChain,
        address emitterAddress
    ) internal returns (bytes memory message) {
        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        vm.prank(caller);
        engine.executeFastOrder(fastMessage);

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        message = wormholeSimulator.fetchSignedMessageFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0], emitterChain, emitterAddress
        );
    }

    function _executeSlowOrder(
        bytes memory fastTransferVaa,
        CctpMessage memory params,
        address caller
    ) internal returns (IWormhole.VM memory message) {
        // Record logs for placeMarketOrder.
        vm.recordLogs();

        vm.prank(caller);
        engine.executeSlowOrderAndRedeem(fastTransferVaa, params);

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        message = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        );
    }

    function _verifyAuctionState(
        Messages.FastMarketOrder memory order,
        uint64 feeBid,
        address currentBidder,
        address initialBidder,
        bytes32 vmHash
    ) internal {
        LiveAuctionData memory auction = engine.liveAuctionInfo(vmHash);
        assertEq(uint8(auction.status), uint8(AuctionStatus.Active));
        assertEq(auction.startBlock, uint88(block.number));
        assertEq(auction.highestBidder, currentBidder);
        assertEq(auction.initialBidder, initialBidder);
        assertEq(auction.amount, order.amountIn);
        assertEq(auction.securityDeposit, order.maxFee);
        assertEq(auction.bidPrice, feeBid);
    }

    function _verifyOutboundCctpTransfer(
        Messages.FastMarketOrder memory order,
        uint64 transferAmount,
        IWormhole.VM memory cctpMessage,
        address caller
    ) internal {
        // Verify that the correct amount was sent in the CCTP order.
        (
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 targetCctpDomain,
            ,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        ) = cctpMessage.decodeDeposit();

        assertEq(
            payload,
            Messages.Fill({
                sourceChain: ARB_CHAIN,
                orderSender: address(this).toUniversalAddress(),
                redeemer: order.redeemer,
                redeemerMessage: order.redeemerMessage
            }).encode()
        );

        // Compare the expected values with the actual deposit message.
        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, transferAmount);
        assertEq(sourceCctpDomain, ENGINE_DOMAIN);
        assertEq(targetCctpDomain, ETH_DOMAIN);
        assertEq(burnSource, caller.toUniversalAddress());
        assertEq(mintRecipient, ETH_ROUTER);
    }

    function _getFastMarketOrder(uint64 amountIn)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        return _getFastMarketOrder(amountIn, ETH_CHAIN, ETH_DOMAIN, 0);
    }

    function _getFastMarketOrder(uint64 amountIn, uint32 deadline)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        return _getFastMarketOrder(amountIn, ETH_CHAIN, ETH_DOMAIN, deadline);
    }

    function _getFastMarketOrder(
        uint64 amountIn,
        uint16 targetChain,
        uint32 targetDomain,
        uint32 deadline
    ) internal view returns (Messages.FastMarketOrder memory order, bytes memory fastMessage) {
        return _getFastMarketOrder(amountIn, targetChain, targetDomain, deadline, 1234567);
    }

    function _getFastMarketOrder(
        uint64 amountIn,
        uint16 targetChain,
        uint32 targetDomain,
        uint32 deadline,
        uint32 vaaTimestamp
    ) internal view returns (Messages.FastMarketOrder memory order, bytes memory fastMessage) {
        order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: targetChain,
            targetDomain: targetDomain,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Fast market order sequence.
        uint64 sequence = 69;

        // Generate the fast message vaa using the information from the fast order.
        fastMessage =
            _createSignedVaa(ARB_CHAIN, ARB_ROUTER, sequence, vaaTimestamp, order.encode());
    }

    function _getMinTransferAmount() internal pure returns (uint64) {
        return FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE + 1;
    }

    function _getMaxTransferAmount() internal pure returns (uint64) {
        return FAST_TRANSFER_MAX_AMOUNT;
    }

    function _calculateFastTransferFee(uint64 amount) internal view returns (uint64) {
        if (amount < FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE) {
            revert();
        }

        uint64 transferFee = uint64(
            (amount - FAST_TRANSFER_BASE_FEE - FAST_TRANSFER_INIT_AUCTION_FEE)
                * TEST_TRANSFER_FEE_IN_BPS / engine.maxBpsFee()
        );

        return transferFee + FAST_TRANSFER_BASE_FEE;
    }

    function _dealAndApproveUsdc(IMatchingEngine _engine, uint256 amount, address owner) internal {
        mintUSDC(amount, owner);

        vm.prank(owner);
        IERC20(USDC_ADDRESS).approve(address(_engine), amount);
    }

    function mintUSDC(uint256 amount, address receiver) public {
        IUSDC usdc = IUSDC(USDC_ADDRESS);
        require(amount <= type(uint256).max - usdc.totalSupply(), "total supply overflow");
        vm.prank(usdc.masterMinter());
        usdc.configureMinter(address(this), type(uint256).max);
        usdc.mint(receiver, amount);
    }

    function _createSignedVaa(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        uint64 sequence,
        bytes memory payload
    ) internal view returns (bytes memory) {
        uint32 timestamp = 1234567;
        return _createSignedVaa(emitterChainId, emitterAddress, sequence, timestamp, payload);
    }

    function _createSignedVaa(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        uint64 sequence,
        uint32 timestamp,
        bytes memory payload
    ) internal view returns (bytes memory) {
        IWormhole.VM memory vaa = IWormhole.VM({
            version: 1,
            timestamp: timestamp,
            nonce: 0,
            emitterChainId: emitterChainId,
            emitterAddress: emitterAddress,
            sequence: sequence,
            consistencyLevel: 1,
            payload: payload,
            guardianSetIndex: wormholeSimulator.currentGuardianSetIndex(),
            signatures: new IWormhole.Signature[](0),
            hash: 0x00
        });

        return wormholeSimulator.encodeAndSignMessage(vaa);
    }

    function _craftWormholeCctpRedeemParams(
        IMatchingEngine _engine,
        uint256 amount,
        bytes memory encodedMessage,
        uint64 slowSequence
    ) internal view returns (CctpMessage memory) {
        return _craftWormholeCctpRedeemParams(
            _engine, amount, ARB_ROUTER, ARB_CHAIN, ARB_DOMAIN, slowSequence, encodedMessage
        );
    }

    function _craftWormholeCctpRedeemParams(
        IMatchingEngine _engine,
        uint256 amount,
        bytes32 emitterAddress,
        uint16 fromChain,
        uint32 fromDomain,
        uint64 slowSequence,
        bytes memory encodedMessage
    ) internal view returns (CctpMessage memory) {
        bytes memory encodedDeposit = WormholeCctpMessages.encodeDeposit(
            ARBITRUM_USDC_ADDRESS,
            amount,
            fromDomain,
            ENGINE_DOMAIN,
            2 ** 64 - 1, // Nonce.
            emitterAddress,
            address(_engine).toUniversalAddress(),
            encodedMessage
        );

        bytes memory encodedVaa =
            _createSignedVaa(fromChain, emitterAddress, slowSequence, encodedDeposit);

        bytes memory circleMessage = circleSimulator.encodeBurnMessageLog(
            CircleSimulator.CircleMessage({
                version: 0,
                sourceDomain: fromDomain,
                targetDomain: ENGINE_DOMAIN,
                nonce: 2 ** 64 - 1,
                sourceCircle: FOREIGN_CIRCLE_BRIDGE,
                targetCircle: CIRCLE_BRIDGE,
                targetCaller: address(_engine).toUniversalAddress(),
                token: ARBITRUM_USDC_ADDRESS.toUniversalAddress(),
                mintRecipient: address(_engine).toUniversalAddress(),
                amount: amount,
                transferInitiator: emitterAddress
            })
        );

        return CctpMessage({
            encodedWormholeMessage: encodedVaa,
            circleBridgeMessage: circleMessage,
            circleAttestation: circleSimulator.attestCircleMessage(circleMessage)
        });
    }

    function _upgradeWithNewAuctionParams(
        uint24 userPenaltyRewardBps,
        uint24 initialPenaltyBps,
        uint8 auctionDuration,
        uint8 auctionGracePeriod,
        uint8 auctionPenaltyBlocks
    ) internal {
        vm.startPrank(makeAddr("owner"));
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE.fromUniversalAddress(),
            userPenaltyRewardBps,
            initialPenaltyBps,
            auctionDuration,
            auctionGracePeriod,
            auctionPenaltyBlocks
        );

        engine.upgradeContract(address(implementation));
    }

    function expectRevert(
        address contractAddress,
        bytes memory encodedSignature,
        bytes memory expectedRevert
    ) internal {
        (bool success, bytes memory result) = contractAddress.call(encodedSignature);
        require(!success, "call did not revert");

        require(keccak256(result) == keccak256(expectedRevert), "call did not revert as expected");
    }
}
