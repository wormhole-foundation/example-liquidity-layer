// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {IUSDC} from "cctp-solidity/IUSDC.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
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
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";
import {LiveAuctionData, AuctionStatus} from "../../src/interfaces/IMatchingEngineTypes.sol";

import {FastTransferParameters} from "../../src/interfaces/ITokenRouterTypes.sol";
import {ITokenRouter} from "../../src/interfaces/ITokenRouter.sol";
import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";
import {TokenRouterSetup} from "../../src/TokenRouter/TokenRouterSetup.sol";
import {RedeemedFill} from "../../src/interfaces/IRedeemFill.sol";

contract MatchingEngineTest is Test {
    using Messages for *;

    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;
    address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
    uint16 constant ARB_CHAIN = 23;
    uint16 constant AVAX_CHAIN = 6;
    uint16 constant ETH_CHAIN = 2;

    // Environment variables.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    bytes32 immutable CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("AVAX_CIRCLE_BRIDGE"));
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");

    bytes32 immutable FOREIGN_CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("ARB_CIRCLE_BRIDGE"));
    bytes32 immutable FOREIGN_WORMHOLE_CCTP =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_INTEGRATION"));

    bytes32 immutable TEST_REDEEMER = toUniversalAddress(makeAddr("TEST_REDEEMER"));

    // Used to calculate a theo price for the fast transfer fee.
    uint128 immutable TEST_TRANSFER_FEE_IN_BPS = 25000; // 0.25%.

    // Fast transfer outbound parameters.
    uint128 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint128 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint128 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Initial Auction parameters.
    uint24 immutable USER_PENALTY_REWARD_BPS = 250000; // 25%.
    uint24 immutable INITIAL_PENALTY_BPS = 100000; // 10%.
    uint8 immutable AUCTION_DURATION = 2; // Two blocks ~6 seconds.
    uint8 immutable AUCTION_GRACE_PERIOD = 6; // Includes the auction duration.
    uint8 immutable AUCTION_PENALTY_BLOCKS = 20;

    // Test router endpoints.
    bytes32 immutable ETH_ROUTER = toUniversalAddress(makeAddr("ETH_ROUTER"));
    bytes32 immutable ARB_ROUTER = toUniversalAddress(makeAddr("ARB_ROUTER"));

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

    // Convenient interfaces.
    ICircleIntegration wormholeCctp;

    function deployProxy(address _token, address _wormholeCircle)
        internal
        returns (IMatchingEngine)
    {
        // Deploy Implementation.
        MatchingEngineImplementation implementation = new MatchingEngineImplementation(
            _token,
            _wormholeCircle,
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
        wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

        vm.startPrank(makeAddr("owner"));
        engine = deployProxy(USDC_ADDRESS, address(wormholeCctp));

        // Set up the router endpoints.
        engine.addRouterEndpoint(ARB_CHAIN, ARB_ROUTER);
        engine.addRouterEndpoint(ETH_CHAIN, ETH_ROUTER);

        vm.stopPrank();

        wormholeSimulator = new SigningWormholeSimulator(wormholeCctp.wormhole(), TESTING_SIGNER);

        circleSimulator =
            new CircleSimulator(TESTING_SIGNER, MESSAGE_TRANSMITTER, ARBITRUM_USDC_ADDRESS);
        circleSimulator.setupCircleAttester();
    }

    /**
     * ADMIN TESTS
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            USDC_ADDRESS,
            address(wormholeCctp),
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
            address(wormholeCctp),
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
            address(wormholeCctp),
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
            address(wormholeCctp),
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
            address(wormholeCctp),
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
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        assertEq(engine.getRouter(chain), bytes32(0));

        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(chain, routerEndpoint);

        assertEq(engine.getRouter(chain), routerEndpoint);
    }

    function testCannotAddRouterEndpointChainIdZero() public {
        uint16 chain = 0;
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        engine.addRouterEndpoint(chain, routerEndpoint);
    }

    function testCannotAddRouterEndpointInvalidEndpoint() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = bytes32(0);

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEndpoint(bytes32)", routerEndpoint));
        engine.addRouterEndpoint(chain, routerEndpoint);
    }

    function testCannotAddRouterEndpointOwnerOrAssistantOnly() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        engine.addRouterEndpoint(chain, routerEndpoint);
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

    /**
     * AUCTION TESTS
     */

    function testCalculateDynamicPenalty() public {
        // Still in grace period.
        {
            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() - 1);
            assertEq(penalty, 0);
            assertEq(reward, 0);
        }

        // Penalty period is over.
        {
            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) = engine.calculateDynamicPenalty(
                amount, engine.getAuctionPenaltyBlocks() + engine.getAuctionGracePeriod()
            );
            assertEq(penalty, 7500000);
            assertEq(reward, 2500000);
        }

        // One block into the penalty period.
        {
            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 1);
            assertEq(penalty, 1087500);
            assertEq(reward, 362500);
        }

        // 50% of the way through the penalty period.
        {
            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 4125000);
            assertEq(reward, 1375000);
        }

        // Penalty period boundary (19/20)
        {
            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
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

            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
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

            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
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

            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
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

            uint128 amount = 10000000;
            (uint128 penalty, uint128 reward) =
                engine.calculateDynamicPenalty(amount, engine.getAuctionGracePeriod() + 10);
            assertEq(penalty, 0);
            assertEq(reward, 7500000);
        }
    }

    /**
     * PLACE INITIAL BID TESTS
     */

    function testPlaceInitialBid(uint128 amountIn, uint128 feeBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        // This method explicitly sets the deadline to zero.
        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Cap the fee bid.
        feeBid = uint128(bound(feeBid, 0, order.maxFee));

        // Place initial bid with player one and verify the state changes.
        _placeInitialBid(order, fastMessage, feeBid, PLAYER_ONE);
    }

    function testPlaceInitialBidWithDeadline(
        uint128 amountIn,
        uint128 feeBid,
        uint32 timeToDeadline
    ) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));
        timeToDeadline =
            uint32(bound(timeToDeadline, 5, type(uint32).max - uint32(block.timestamp)));
        uint32 deadline = uint32(block.timestamp + timeToDeadline);

        // This method explicitly sets the deadline to zero.
        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence, deadline);

        // Cap the fee bid.
        feeBid = uint128(bound(feeBid, 0, order.maxFee));

        // Place initial bid with player one and verify the state changes.
        _placeInitialBid(order, fastMessage, feeBid, PLAYER_ONE);
    }

    function testCannotPlaceInitialBidDeadlineExceeded() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint128 transferFee = _calculateFastTransferFee(amountIn);
        uint32 deadline = uint32(block.timestamp) + 10;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: 69,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
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
        uint64 slowMessageSequence = 69;

        (, bytes memory fastMessage) =
            _getFastMarketOrder(_getMinTransferAmount(), slowMessageSequence);

        // Modify the vaa.
        fastMessage[5] = 0x00;

        vm.expectRevert(abi.encodeWithSignature("ErrInvalidWormholeMessage(string)", "no quorum"));
        engine.placeInitialBid(fastMessage, 69);
    }

    function testCannotPlaceInitialBidInvalidRouterPath() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint128 bid = 420;
        uint16 invalidChain = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: 69,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
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
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint128 bid = 420;
        uint16 invalidChain = 69;

        // Use an invalid target chain.
        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: invalidChain,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: 69,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
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
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint128 transferFee = _calculateFastTransferFee(amountIn);

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: 69,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
            maxFee: transferFee,
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Use an emitter chain that is not registered.
        bytes memory fastMessage = _createSignedVaa(ARB_CHAIN, ARB_ROUTER, 0, order.encode());

        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrBidPriceTooHigh(uint128,uint128)", transferFee + 1, transferFee
            )
        );
        engine.placeInitialBid(fastMessage, transferFee + 1);
    }

    function testCannotPlaceInitialBidAuctionNotActive() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

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
    function testPlaceInitialBidAgain(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint128(bound(newBid, 0, order.maxFee));

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
        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        _verifyAuctionState(order, newBid, PLAYER_TWO, PLAYER_ONE, _vm.hash);
    }

    /**
     * IMPROVE BID TESTS
     */

    function testImproveBid(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint128(bound(newBid, 0, order.maxFee));

        _improveBid(order, fastMessage, newBid, PLAYER_ONE, PLAYER_TWO);
    }

    function testImproveBidWithHighestBidder(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint128(bound(newBid, 0, order.maxFee));

        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        // Improve the bid with player one, so we're basically modifying
        // the existing bid.
        vm.prank(PLAYER_ONE);
        engine.improveBid(_vm.hash, newBid);

        assertEq(balanceBefore, IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE));

        _verifyAuctionState(order, newBid, PLAYER_ONE, PLAYER_ONE, _vm.hash);
    }

    function testCannotImproveBidAuctionAlreadyCompleted() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

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
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        // Attempt to improve a bid on an auction that hasn't started.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionNotActive(bytes32)", auctionId));
        engine.improveBid(auctionId, order.maxFee - 1);
    }

    function testCannotImproveBidAuctionExpired() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Warp the block into the grace period.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);

        // Attempt to improve a bid on an auction that has expired.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionPeriodExpired()"));
        engine.improveBid(auctionId, order.maxFee - 1);
    }

    function testCannotImproveBidPriceTooHigh() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Try to place a bid with the same price.
        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrBidPriceTooHigh(uint128,uint128)", order.maxFee, order.maxFee
            )
        );
        engine.improveBid(auctionId, order.maxFee);
    }

    /**
     * EXECUTE FAST ORDER TESTS
     */

    function testExecuteFastOrder(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint128(bound(newBid, 0, order.maxFee));
        _improveBid(order, fastMessage, newBid, PLAYER_ONE, PLAYER_TWO);

        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        // Warp the block into the grace period.
        vm.roll(engine.liveAuctionInfo(_vm.hash).startBlock + engine.getAuctionDuration() + 1);

        // Execute the fast order. The highest bidder should receive the security deposit,
        // plus the agreed upon fee back. The initial bidder should receive the init fee.
        uint256 highBidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);
        uint256 initialBidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        bytes memory cctpPayload = _executeFastOrder(fastMessage, PLAYER_TWO);

        _verifyOutboundCctpTransfer(
            order, amountIn - newBid - FAST_TRANSFER_INIT_AUCTION_FEE, cctpPayload
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

    function testExecuteFastOrderWithPenalty(uint128 amountIn, uint8 penaltyBlocks) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        uint128 bidPrice = order.maxFee - 1;
        _placeInitialBid(order, fastMessage, bidPrice, PLAYER_ONE);

        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        // Warp the block into the penalty period.
        penaltyBlocks = uint8(bound(penaltyBlocks, 1, engine.getAuctionPenaltyBlocks() + 1));
        uint128 startBlock = engine.liveAuctionInfo(_vm.hash).startBlock;
        vm.roll(startBlock + engine.getAuctionGracePeriod() + penaltyBlocks);

        // Calculate the expected penalty and reward.
        (uint128 expectedPenalty, uint128 expectedReward) =
            engine.calculateDynamicPenalty(order.maxFee, uint128(block.number - startBlock));

        // Execute the fast order, the highest bidder should receive some of their security deposit
        // (less penalties).
        uint256 bidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);
        uint256 liquidatorBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        // Execute the fast order using the "liquidator".
        bytes memory cctpPayload = _executeFastOrder(fastMessage, PLAYER_TWO);

        _verifyOutboundCctpTransfer(
            order,
            amountIn - bidPrice - FAST_TRANSFER_INIT_AUCTION_FEE + expectedReward,
            cctpPayload
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
        uint128 amountIn = _getMinTransferAmount() + 69;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

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
        uint128 amountIn = _getMinTransferAmount() + 69;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // NOTE: We skip rolling the block number on purpose.

        // Attempt to execute the fast order on a completed auction.
        vm.expectRevert(abi.encodeWithSignature("ErrAuctionPeriodNotComplete()"));
        engine.executeFastOrder(fastMessage);
    }

    function testCannotExecuteFastOrderAuctionInvalidWormholeMessage() public {
        uint128 amountIn = _getMinTransferAmount() + 69;
        uint64 slowMessageSequence = 69;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

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

    function testExecuteSlowOrderAndRedeem(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint128(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        // Warp the block into the grace period and execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        _executeFastOrder(fastMessage, PLAYER_TWO);

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowMessageSequence
        );

        // Execute the slow order, the highest bidder should receive their initial deposit.
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        vm.prank(PLAYER_TWO);
        engine.executeSlowOrderAndRedeem(fastMessage, params);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - balanceBefore, order.amountIn);
    }

    function testExecuteSlowOrderAndRedeemAuctionNotStarted(uint128 amountIn) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // NOTE: We skip starting the auction on purpose.

        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowMessageSequence
        );

        // Execute the slow order, the highest bidder should receive their initial deposit.
        // The fee recipient should receive the base fee, even though the caller isn't
        // the same address.
        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 feeRecipientBefore = IERC20(USDC_ADDRESS).balanceOf(FEE_RECIPIENT);
        uint256 contractBefore = IERC20(USDC_ADDRESS).balanceOf(address(engine));

        // Since the auction was never started, the relayer should receive the base fee,
        // and the contract's balance shouldn't change (no funds were custodied).
        bytes memory cctpPayload = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(order, amountIn - FAST_TRANSFER_BASE_FEE, cctpPayload);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(RELAYER) - relayerBefore, 0);
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(FEE_RECIPIENT) - feeRecipientBefore,
            FAST_TRANSFER_BASE_FEE
        );
        assertEq(IERC20(USDC_ADDRESS).balanceOf(address(engine)), contractBefore);
        assertEq(uint8(engine.getAuctionStatus(auctionId)), uint8(AuctionStatus.Completed));
    }

    function testExecuteSlowOrderAndRedeemAuctionStillActive(uint128 amountIn, uint128 newBid)
        public
    {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Cache security deposit for later use.
        uint128 securityDeposit = order.maxFee;

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint128(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        // Warp the block into the grace period and execute the fast order, but DO NOT
        // execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowMessageSequence
        );

        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 playerBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        bytes memory cctpPayload = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(order, amountIn - FAST_TRANSFER_BASE_FEE, cctpPayload);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(RELAYER) - relayerBefore, FAST_TRANSFER_BASE_FEE);
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - playerBefore,
            order.amountIn + securityDeposit
        );
    }

    function testExecuteSlowOrderAndRedeemAuctionStillActiveWithPenalty(
        uint128 amountIn,
        uint8 penaltyBlocks
    ) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Cache security deposit for later use.
        uint256 securityDeposit = order.maxFee;

        // Place initial bid for the max fee with player one.
        uint128 bidPrice = order.maxFee - 1;
        _placeInitialBid(order, fastMessage, bidPrice, PLAYER_ONE);

        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        // Warp the block into the penalty period.
        penaltyBlocks = uint8(bound(penaltyBlocks, 1, engine.getAuctionPenaltyBlocks() + 1));
        uint128 startBlock = engine.liveAuctionInfo(auctionId).startBlock;
        vm.roll(startBlock + engine.getAuctionGracePeriod() + penaltyBlocks);

        // Calculate the expected penalty and reward.
        (uint128 expectedPenalty, uint128 expectedReward) =
            engine.calculateDynamicPenalty(order.maxFee, uint128(block.number - startBlock));

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowMessageSequence
        );

        uint256 relayerBefore = IERC20(USDC_ADDRESS).balanceOf(RELAYER);
        uint256 playerBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);

        bytes memory cctpPayload = _executeSlowOrder(fastMessage, params, RELAYER);

        _verifyOutboundCctpTransfer(
            order, amountIn - FAST_TRANSFER_BASE_FEE + expectedReward, cctpPayload
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
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint64 slowSequence = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ETH_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });
        bytes memory fastMessage =
            _createSignedVaa(ARB_CHAIN, ARB_ROUTER, slowSequence, order.encode());

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowSequence
        );

        // Change the address for the arb router.
        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(ARB_CHAIN, bytes32("deadbeef"));

        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidSourceRouter(bytes32,bytes32)", ARB_ROUTER, bytes32("deadbeef")
            )
        );
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemInvalidTargetRouter() public {
        uint128 amountIn = _getMinTransferAmount() + 6900;
        uint16 invalidTargetChain = 69;
        uint64 slowSequence = 69;

        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: invalidTargetChain,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });
        bytes memory fastMessage =
            _createSignedVaa(ARB_CHAIN, ARB_ROUTER, slowSequence, order.encode());

        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine,
            amountIn,
            Messages.SlowOrderResponse({baseFee: FAST_TRANSFER_BASE_FEE}).encode(),
            slowSequence
        );

        vm.expectRevert(
            abi.encodeWithSignature("ErrInvalidTargetRouter(uint16)", invalidTargetChain)
        );
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchCompletedAuction() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        _executeFastOrder(fastMessage, PLAYER_TWO);

        // NOTE: Create slow VAA with a different sequence number.
        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine, amountIn, order.encode(), slowMessageSequence + 1
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchActiveAuction() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);
        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        // Do not execute the fast order.

        // NOTE: Create slow VAA with a different sequence number.
        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine, amountIn, order.encode(), slowMessageSequence + 1
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    function testCannotExecuteSlowOrderAndRedeemVaaMismatchAuctionNotStarted() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 6900;

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // NOTE: Create slow VAA with a different sequence number.
        ICircleIntegration.RedeemParameters memory params = _craftWormholeCctpRedeemParams(
            engine, amountIn, order.encode(), slowMessageSequence + 1
        );

        vm.expectRevert(abi.encodeWithSignature("ErrVaaMismatch()"));
        engine.executeSlowOrderAndRedeem(fastMessage, params);
    }

    /**
     * FAST FILL TESTS
     */

    function testRedeemFastFill(uint128 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = uint128(bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount()));

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);

        // Start the auction and make some bids.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
        _improveBid(
            order, fastMessage, uint128(bound(newBid, 0, order.maxFee)), PLAYER_ONE, PLAYER_TWO
        );

        bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

        // Warp the block into the grace period and execute the fast order.
        vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
        bytes memory fastFill =
            _executeFastOrder(fastMessage, PLAYER_TWO, true, AVAX_CHAIN, address(engine));

        address testRedeemer = fromUniversalAddress(TEST_REDEEMER);
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
        assertEq(fill.sender, toUniversalAddress(address(this)));
        assertEq(fill.senderChain, ARB_CHAIN);
        assertEq(fill.token, address(USDC_ADDRESS));
        assertEq(fill.amount, expectedFillAmount);
        assertEq(fill.message, order.redeemerMessage);
    }

    function testCannotRedeemFastFillInvalidEmitterChain() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 69;
        uint16 invalidEmitterChain = 69;

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);
            bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrder(
                fastMessage, PLAYER_ONE, true, invalidEmitterChain, address(engine)
            );
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(address(avaxRouter));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEmitterForFastFill()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidEmitterAddress() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 69;
        address invalidEmitterAddress = makeAddr("invalidEmitter");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);
            bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill =
                _executeFastOrder(fastMessage, PLAYER_ONE, true, AVAX_CHAIN, invalidEmitterAddress);
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(address(avaxRouter));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEmitterForFastFill()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidSourceRouter() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 69;
        address invalidRouter = makeAddr("invalidRouter");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);
            bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrder(fastMessage, PLAYER_ONE, true, AVAX_CHAIN, address(engine));
        }

        // Call the matching engine directly for this test. This is because the
        // TokenRouter does an emitter check and will not redeem the fast fill.
        vm.prank(invalidRouter);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidSourceRouter(bytes32,bytes32)",
                toUniversalAddress(invalidRouter),
                toUniversalAddress(address(avaxRouter))
            )
        );
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillAgain() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 69;

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);
            bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrder(fastMessage, PLAYER_ONE, true, AVAX_CHAIN, address(engine));
        }

        // Successfull redeem the fill.
        vm.startPrank(address(avaxRouter));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);

        // Now try again.
        vm.expectRevert(abi.encodeWithSignature("ErrFastFillAlreadyRedeemed()"));
        IMatchingEngine(address(engine)).redeemFastFill(fastFill);
    }

    function testCannotRedeemFastFillInvalidRedeemer() public {
        uint64 slowMessageSequence = 69;
        uint128 amountIn = _getMinTransferAmount() + 69420;
        address invalidRedeemer = makeAddr("invalidRedeemer");

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        // Complete a successful auction.
        bytes memory fastFill;
        {
            (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
                _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN, 0);
            bytes32 auctionId = wormholeCctp.wormhole().parseVM(fastMessage).hash;

            _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);
            vm.roll(engine.liveAuctionInfo(auctionId).startBlock + engine.getAuctionDuration() + 1);
            fastFill = _executeFastOrder(fastMessage, PLAYER_ONE, true, AVAX_CHAIN, address(engine));
        }

        vm.prank(invalidRedeemer);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ErrInvalidRedeemer(bytes32,bytes32)",
                toUniversalAddress(invalidRedeemer),
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
            USDC_ADDRESS, address(wormholeCctp), AVAX_CHAIN, toUniversalAddress(address(engine))
        );

        // Deploy Setup.
        TokenRouterSetup setup = new TokenRouterSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        vm.prank(makeAddr("owner"));
        engine.addRouterEndpoint(AVAX_CHAIN, toUniversalAddress(proxy));

        return ITokenRouter(proxy);
    }

    function _placeInitialBid(
        Messages.FastMarketOrder memory order,
        bytes memory fastMessage,
        uint128 feeBid,
        address bidder
    ) internal {
        _dealAndApproveUsdc(engine, order.amountIn + order.maxFee, bidder);

        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(bidder);

        // Place the initial bid as player one.
        vm.prank(bidder);
        engine.placeInitialBid(fastMessage, feeBid);

        // Validate state and balance changes.
        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        assertEq(
            balanceBefore - IERC20(USDC_ADDRESS).balanceOf(bidder), order.amountIn + order.maxFee
        );

        _verifyAuctionState(order, feeBid, bidder, bidder, _vm.hash);
    }

    function _improveBid(
        Messages.FastMarketOrder memory order,
        bytes memory fastMessage,
        uint128 newBid,
        address initialBidder,
        address newBidder
    ) internal {
        _dealAndApproveUsdc(engine, order.amountIn + order.maxFee, newBidder);

        uint256 newBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(newBidder);
        uint256 oldBalanceBefore = IERC20(USDC_ADDRESS).balanceOf(initialBidder);

        // Validate state and balance changes.
        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

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
        returns (bytes memory message)
    {
        return _executeFastOrder(fastMessage, caller, false, 0, address(0));
    }

    function _executeFastOrder(
        bytes memory fastMessage,
        address caller,
        bool signedMessage,
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

        if (signedMessage) {
            message = wormholeSimulator.fetchSignedMessageFromLogs(
                wormholeSimulator.fetchWormholeMessageFromLog(logs)[0], emitterChain, emitterAddress
            );
        } else {
            message = wormholeSimulator.parseVMFromLogs(
                wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
            ).payload;
        }
    }

    function _executeSlowOrder(
        bytes memory fastTransferVaa,
        ICircleIntegration.RedeemParameters memory params,
        address caller
    ) internal returns (bytes memory message) {
        // Record logs for placeMarketOrder.
        vm.recordLogs();

        vm.prank(caller);
        engine.executeSlowOrderAndRedeem(fastTransferVaa, params);

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        message = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;
    }

    function _verifyAuctionState(
        Messages.FastMarketOrder memory order,
        uint128 feeBid,
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
        uint128 transferAmount,
        bytes memory cctpPayload
    ) internal {
        // Verify that the correct amount was sent in the CCTP order.
        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(cctpPayload);

        assertEq(
            deposit.payload,
            Messages.Fill({
                sourceChain: ARB_CHAIN,
                orderSender: toUniversalAddress(address(this)),
                redeemer: order.redeemer,
                redeemerMessage: order.redeemerMessage
            }).encode()
        );

        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: transferAmount,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(ETH_CHAIN),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(engine)),
            mintRecipient: ETH_ROUTER,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function _getFastMarketOrder(uint128 amountIn, uint64 slowSequence)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        return _getFastMarketOrder(amountIn, slowSequence, ETH_CHAIN, 0);
    }

    function _getFastMarketOrder(uint128 amountIn, uint64 slowSequence, uint32 deadline)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        return _getFastMarketOrder(amountIn, slowSequence, ETH_CHAIN, deadline);
    }

    function _getFastMarketOrder(
        uint128 amountIn,
        uint64 slowSequence,
        uint16 targetChain,
        uint32 deadline
    ) internal view returns (Messages.FastMarketOrder memory order, bytes memory fastMessage) {
        order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: targetChain,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            slowEmitter: wormholeCctp.getRegisteredEmitter(ARB_CHAIN),
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Generate the fast message vaa using the information from the fast order.
        fastMessage = _createSignedVaa(ARB_CHAIN, ARB_ROUTER, 0, order.encode());
    }

    function _getMinTransferAmount() internal pure returns (uint128) {
        return FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE + 1;
    }

    function _getMaxTransferAmount() internal pure returns (uint128) {
        return FAST_TRANSFER_MAX_AMOUNT;
    }

    function _calculateFastTransferFee(uint128 amount) internal view returns (uint128) {
        if (amount < FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE) {
            revert();
        }

        uint128 transferFee = uint128(
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
        IWormhole.VM memory vaa = IWormhole.VM({
            version: 1,
            timestamp: 1234567,
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
    ) internal returns (ICircleIntegration.RedeemParameters memory) {
        return _craftWormholeCctpRedeemParams(
            _engine, amount, ARB_ROUTER, ARB_CHAIN, slowSequence, encodedMessage
        );
    }

    function _craftWormholeCctpRedeemParams(
        IMatchingEngine _engine,
        uint256 amount,
        bytes32 fromAddress,
        uint16 fromChain,
        uint64 slowSequence,
        bytes memory encodedMessage
    ) internal returns (ICircleIntegration.RedeemParameters memory) {
        bytes32 emitterAddress = wormholeCctp.getRegisteredEmitter(fromChain);
        assertNotEq(emitterAddress, bytes32(0));

        ICircleIntegration.DepositWithPayload memory deposit = ICircleIntegration.DepositWithPayload({
            token: toUniversalAddress(ARBITRUM_USDC_ADDRESS),
            amount: amount,
            sourceDomain: wormholeCctp.getDomainFromChainId(fromChain),
            targetDomain: wormholeCctp.localDomain(),
            nonce: 2 ** 64 - 1,
            fromAddress: fromAddress,
            mintRecipient: toUniversalAddress(address(_engine)),
            payload: encodedMessage
        });

        bytes memory encodedVaa = _createSignedVaa(
            fromChain, emitterAddress, slowSequence, wormholeCctp.encodeDepositWithPayload(deposit)
        );

        bytes memory circleMessage = circleSimulator.encodeBurnMessageLog(
            CircleSimulator.CircleMessage({
                version: 0,
                sourceDomain: deposit.sourceDomain,
                targetDomain: deposit.targetDomain,
                nonce: deposit.nonce,
                sourceCircle: FOREIGN_CIRCLE_BRIDGE,
                targetCircle: CIRCLE_BRIDGE,
                targetCaller: toUniversalAddress((address(wormholeCctp))),
                token: deposit.token,
                mintRecipient: deposit.mintRecipient,
                amount: deposit.amount,
                transferInitiator: FOREIGN_WORMHOLE_CCTP
            })
        );

        return ICircleIntegration.RedeemParameters({
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
            address(wormholeCctp),
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
