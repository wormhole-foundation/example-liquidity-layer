// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
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

import "../../src/interfaces/Types.sol";
import {Messages} from "../../src/shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import {IMatchingEngine} from "../../src/interfaces/IMatchingEngine.sol";
import {FastTransferParameters} from "../../src/interfaces/Types.sol";
import "../../src/MatchingEngine/assets/Storage.sol";

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

    // Fast transfer outbound parameters.
    uint24 immutable FAST_TRANSFER_FEE_IN_BPS = 25000; // 0.25%.
    uint128 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint128 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint128 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Test router endpoints.
    bytes32 immutable ETH_ROUTER = toUniversalAddress(makeAddr("ETH_ROUTER"));
    bytes32 immutable ARB_ROUTER = toUniversalAddress(makeAddr("ARB_ROUTER"));

    // Players.
    address immutable PLAYER_ONE = makeAddr("player one");
    address immutable PLAYER_TWO = makeAddr("player two");
    address immutable PLAYER_THREE = makeAddr("player three");

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
            _wormholeCircle,
            _token
        );

        // Deploy Setup.
        MatchingEngineSetup setup = new MatchingEngineSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        return IMatchingEngine(proxy);
    }

    function setUp() public {
        wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

        vm.startPrank(makeAddr("owner"));
        engine = deployProxy(USDC_ADDRESS, address(wormholeCctp));

        // Set up the router endpoints.
        engine.addRouterEndpoint(ARB_CHAIN, ARB_ROUTER);
        engine.addRouterEndpoint(ETH_CHAIN, ETH_ROUTER);

        // Set the auction config.
        engine.setAuctionConfig(
            AuctionConfig({
                auctionDuration: 2, // Two blocks ~6 seconds.
                auctionGracePeriod: 6, // Includes the auction duration.
                penaltyBlocks: 20,
                userPenaltyRewardBps: 250000, // 25%
                initialPenaltyBps: 100000 // 10%
            })
        );

        vm.stopPrank();

        wormholeSimulator = new SigningWormholeSimulator(
            wormholeCctp.wormhole(),
            TESTING_SIGNER
        );

        circleSimulator = new CircleSimulator(
            TESTING_SIGNER,
            MESSAGE_TRANSMITTER,
            ARBITRUM_USDC_ADDRESS
        );
        circleSimulator.setupCircleAttester();
    }

    /**
     * ADMIN TESTS
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockMatchingEngineImplementation newImplementation = new MockMatchingEngineImplementation(
            address(wormholeCctp),
            USDC_ADDRESS
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
            address(wormholeCctp),
            USDC_ADDRESS
        );

        vm.startPrank(makeAddr("owner"));

        // Upgrade the contract.
        engine.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        engine.upgradeContract(address(newImplementation));
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

    /**
     * AUCTION TESTS
     */

    function testPlaceInitialBid(uint256 amountIn, uint128 feeBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Cap the fee bid.
        feeBid = uint128(bound(feeBid, 0, order.maxFee));

        // Place initial bid with player one and verify the state changes.
        _placeInitialBid(order, fastMessage, feeBid, PLAYER_ONE);
    }

    /**
     * @notice This test demonstrates how the contract does not revert if
     * two players are racing to place the initial bid. Instead, `_improveBid`
     * is called and the highest bidder is updated.
     */
    function testPlaceInitialBidAgain(uint256 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

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

        _verifyAuctionState(order, _vm, newBid, PLAYER_TWO, PLAYER_ONE, _vm.hash);
    }

    function testImproveBid(uint256 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        _placeInitialBid(order, fastMessage, order.maxFee, PLAYER_ONE);

        // Create a bid that is lower than the current bid.
        newBid = uint128(bound(newBid, 0, order.maxFee));

        _improveBid(order, fastMessage, newBid, PLAYER_ONE, PLAYER_TWO);
    }

    function testExecuteFastOrder(uint256 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

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

        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - highBidderBefore, order.maxFee + newBid
        );
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - initialBidderBefore,
            FAST_TRANSFER_INIT_AUCTION_FEE
        );
        assertEq(uint8(engine.getAuctionStatus(_vm.hash)), uint8(AuctionStatus.Completed));

        // Verify that the correct amount was sent in the CCTP order.
        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(cctpPayload);

        assertEq(
            deposit.payload,
            Messages.Fill({
                sourceChain: _vm.emitterChainId,
                orderSender: toUniversalAddress(address(this)),
                redeemer: order.redeemer,
                redeemerMessage: order.redeemerMessage
            }).encode()
        );

        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn - newBid - FAST_TRANSFER_INIT_AUCTION_FEE,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(ETH_CHAIN),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(engine)),
            mintRecipient: ETH_ROUTER,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testExecuteFastOrderWithPenalty(uint256 amountIn, uint8 penaltyBlocks) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence);

        // Place initial bid for the max fee with player one.
        uint128 bidPrice = order.maxFee - 1;
        _placeInitialBid(order, fastMessage, bidPrice, PLAYER_ONE);

        IWormhole.VM memory _vm = wormholeCctp.wormhole().parseVM(fastMessage);

        // Warp the block into the penalty period.
        penaltyBlocks = uint8(bound(penaltyBlocks, 1, engine.getAuctionPenaltyBlocks()));
        uint88 startBlock = engine.liveAuctionInfo(_vm.hash).startBlock;
        vm.roll(startBlock + engine.getAuctionGracePeriod() + penaltyBlocks);

        // Calculate the expected penalty and reward.
        (uint256 expectedPenalty, uint256 expectedReward) =
            engine.calculateDynamicPenalty(order.maxFee, uint256(block.number - startBlock));

        // Execute the fast order, the highest bidder should receive some of their security deposit
        // (less penalties).
        uint256 bidderBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE);
        uint256 liquidatorBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        // Execute the fast order using the "liquidator".
        bytes memory cctpPayload = _executeFastOrder(fastMessage, PLAYER_TWO);

        // PLAYER_ONE also gets the init fee for creating the auction.
        assertEq(
            IERC20(USDC_ADDRESS).balanceOf(PLAYER_ONE) - bidderBefore,
            bidPrice + order.maxFee - (expectedPenalty + expectedReward)
                + FAST_TRANSFER_INIT_AUCTION_FEE
        );
        assertEq(IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - liquidatorBefore, expectedPenalty);
        assertEq(uint8(engine.getAuctionStatus(_vm.hash)), uint8(AuctionStatus.Completed));

        // Verify that the correct amount was sent in the CCTP order.
        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(cctpPayload);

        assertEq(
            deposit.payload,
            Messages.Fill({
                sourceChain: _vm.emitterChainId,
                orderSender: toUniversalAddress(address(this)),
                redeemer: order.redeemer,
                redeemerMessage: order.redeemerMessage
            }).encode()
        );

        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn - bidPrice - FAST_TRANSFER_INIT_AUCTION_FEE + expectedReward,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(ETH_CHAIN),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(engine)),
            mintRecipient: ETH_ROUTER,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testExecuteSlowOrderAndRedeem(uint256 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

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

        // Update the order, since the `maxFee` is the `baseFee` for slow messages.
        order.slowSequence = 0;
        order.maxFee = FAST_TRANSFER_BASE_FEE;
        order.initAuctionFee = 0;

        ICircleIntegration.RedeemParameters memory params =
            _craftWormholeCctpRedeemParams(engine, amountIn, order.encode(), slowMessageSequence);

        // Execute the slow order, the highest bidder should receive their initial deposit.
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO);

        vm.prank(PLAYER_TWO);
        engine.executeSlowOrderAndRedeem(auctionId, params);

        assertEq(IERC20(USDC_ADDRESS).balanceOf(PLAYER_TWO) - balanceBefore, order.amountIn);
    }

    function testRedeemFastFill(uint256 amountIn, uint128 newBid) public {
        uint64 slowMessageSequence = 69;
        amountIn = bound(amountIn, _getMinTransferAmount(), _getMaxTransferAmount());

        // Deploy the avax token router and register it.
        ITokenRouter avaxRouter = _deployAndRegisterAvaxRouter();

        (Messages.FastMarketOrder memory order, bytes memory fastMessage) =
            _getFastMarketOrder(amountIn, slowMessageSequence, AVAX_CHAIN);

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

    /**
     * TEST HELPERS
     */

    function _deployAndRegisterAvaxRouter() internal returns (ITokenRouter) {
        // Deploy Implementation.
        TokenRouterImplementation implementation = new TokenRouterImplementation(
            USDC_ADDRESS,
            address(wormholeCctp),
            AVAX_CHAIN,
            toUniversalAddress(address(engine))
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

        _verifyAuctionState(order, _vm, feeBid, bidder, bidder, _vm.hash);
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

        // Place the initial bid as player one.
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

        _verifyAuctionState(order, _vm, newBid, newBidder, initialBidder, _vm.hash);
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

    function _verifyAuctionState(
        Messages.FastMarketOrder memory order,
        IWormhole.VM memory _vm,
        uint256 feeBid,
        address currentBidder,
        address initialBidder,
        bytes32 vmHash
    ) internal {
        LiveAuctionData memory auction = engine.liveAuctionInfo(vmHash);
        assertEq(uint8(auction.status), uint8(AuctionStatus.Active));
        assertEq(auction.startBlock, uint88(block.number));
        assertEq(auction.highestBidder, currentBidder);
        assertEq(auction.amount, order.amountIn);
        assertEq(auction.securityDeposit, order.maxFee);
        assertEq(auction.bidPrice, feeBid);

        InitialAuctionData memory initialAuction = engine.initialAuctionInfo(vmHash);
        assertEq(initialAuction.initialBidder, initialBidder);
        assertEq(initialAuction.slowChain, _vm.emitterChainId);
        assertEq(initialAuction.slowSequence, order.slowSequence);
        assertEq(initialAuction.slowEmitter, wormholeCctp.getRegisteredEmitter(_vm.emitterChainId));
    }

    function _getFastMarketOrder(uint256 amountIn, uint64 slowSequence)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        return _getFastMarketOrder(amountIn, slowSequence, ETH_CHAIN);
    }

    function _getFastMarketOrder(uint256 amountIn, uint64 slowSequence, uint16 targetChain)
        internal
        view
        returns (Messages.FastMarketOrder memory order, bytes memory fastMessage)
    {
        order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: targetChain,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            maxFee: _calculateFastTransferFee(amountIn),
            initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE,
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

    function _calculateFastTransferFee(uint256 amount) internal view returns (uint128) {
        uint128 feeInBps = uint128(FAST_TRANSFER_FEE_IN_BPS);

        if (amount < FAST_TRANSFER_BASE_FEE + FAST_TRANSFER_INIT_AUCTION_FEE) {
            revert();
        }

        uint128 transferFee = uint128(
            (amount - FAST_TRANSFER_BASE_FEE - FAST_TRANSFER_INIT_AUCTION_FEE) * feeInBps
                / engine.maxBpsFee()
        );

        return transferFee + FAST_TRANSFER_BASE_FEE;
    }

    function _dealAndApproveUsdc(IMatchingEngine _engine, uint256 amount, address owner) internal {
        deal(USDC_ADDRESS, owner, amount);

        vm.prank(owner);
        IERC20(USDC_ADDRESS).approve(address(_engine), amount);
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
}
