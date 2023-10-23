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

import {IMockOrderRouter, MockOrderRouterImplementation} from "./helpers/mock/MockOrderRouterImplementation.sol";

import {RevertType} from "../../src/interfaces/Types.sol";

import "../../src/OrderRouter/assets/Errors.sol";
import {OrderRouterImplementation} from "../../src/OrderRouter/OrderRouterImplementation.sol";
import {OrderRouterSetup} from "../../src/OrderRouter/OrderRouterSetup.sol";

import {Messages} from "../../src/shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import "../../src/interfaces/IOrderRouter.sol";

contract OrderRouterTest is Test {
    using Messages for *;

    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    // Because this test is run using an Avalanche fork, we need to use a different chain ID for the
    // matching engine.
    uint16 constant MATCHING_ENGINE_CHAIN = 23;
    address constant MATCHING_ENGINE_ADDRESS = 0xBa5EdBA5eDBA5EdbA5edbA5EDBA5eDbA5edBa5Ed;

    uint16 constant CANONICAL_TOKEN_CHAIN = 2;
    address constant CANONICAL_TOKEN_ADDRESS = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
    address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;

    uint24 constant TESTING_TARGET_SLIPPAGE = 200; // 2.00 bps
    bytes32 constant TESTING_FOREIGN_ROUTER_ENDPOINT =
        0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef;

    uint256 constant MAX_UINT256 = 2 ** 256 - 1;

    // Environment variables.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    bytes32 immutable CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("AVAX_CIRCLE_BRIDGE"));
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");

    bytes32 immutable FOREIGN_CIRCLE_BRIDGE =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_BRIDGE"));
    bytes32 immutable FOREIGN_WORMHOLE_CCTP =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_INTEGRATION"));

    // Test routers.
    IOrderRouter nativeRouter;
    IOrderRouter cctpEnabledRouter;
    IOrderRouter canonicalEnabledRouter;

    // Integrating contract helpers.
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;

    // Convenient interfaces.
    ITokenBridge tokenBridge;
    ICircleIntegration wormholeCctp;

    function deployProxy(
        address _token,
        uint16 _matchingEngineChain,
        bytes32 _matchingEngineEndpoint,
        uint16 _canonicalTokenChain,
        bytes32 _canonicalTokenAddress,
        address _tokenBridge,
        address _wormholeCircle
    ) internal returns (IOrderRouter) {
        // Deploy Implementation.
        OrderRouterImplementation implementation = new OrderRouterImplementation(
            _token,
            _matchingEngineChain,
            _matchingEngineEndpoint,
            _canonicalTokenChain,
            _canonicalTokenAddress,
            _tokenBridge,
            _wormholeCircle
        );

        // Deploy Setup.
        OrderRouterSetup setup = new OrderRouterSetup();
        address proxy = setup.deployProxy(
            address(implementation),
            makeAddr("ownerAssistant"),
            0 // Default relayer fee.
        );

        return IOrderRouter(proxy);
    }

    function setUp() public {
        tokenBridge = ITokenBridge(TOKEN_BRIDGE_ADDRESS);
        wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

        // Set up order routers. These routers will represent the different outbound paths.
        {
            // Prank with an arbitrary owner.
            vm.startPrank(makeAddr("owner"));
            nativeRouter = deployProxy(
                USDC_ADDRESS,
                MATCHING_ENGINE_CHAIN,
                toUniversalAddress(MATCHING_ENGINE_ADDRESS),
                CANONICAL_TOKEN_CHAIN,
                toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
                address(tokenBridge),
                address(0) // wormholeCctp
            );
            assert(nativeRouter.tokenType() == TokenType.Native);

            cctpEnabledRouter = deployProxy(
                USDC_ADDRESS,
                MATCHING_ENGINE_CHAIN,
                toUniversalAddress(MATCHING_ENGINE_ADDRESS),
                CANONICAL_TOKEN_CHAIN,
                toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
                address(tokenBridge),
                address(wormholeCctp)
            );
            assert(cctpEnabledRouter.tokenType() == TokenType.Cctp);

            canonicalEnabledRouter = deployProxy(
                _wrappedUsdc(),
                MATCHING_ENGINE_CHAIN,
                toUniversalAddress(MATCHING_ENGINE_ADDRESS),
                CANONICAL_TOKEN_CHAIN,
                toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
                address(tokenBridge),
                address(0)
            );
            assert(canonicalEnabledRouter.tokenType() == TokenType.Canonical);
            vm.stopPrank();
        }

        wormholeSimulator = new SigningWormholeSimulator(
            ITokenBridge(TOKEN_BRIDGE_ADDRESS).wormhole(),
            TESTING_SIGNER
        );

        circleSimulator = new CircleSimulator(
            TESTING_SIGNER,
            MESSAGE_TRANSMITTER,
            ARBITRUM_USDC_ADDRESS
        );
        circleSimulator.setupCircleAttester();
    }

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockOrderRouterImplementation newImplementation = new MockOrderRouterImplementation(
            USDC_ADDRESS,
            MATCHING_ENGINE_CHAIN,
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            CANONICAL_TOKEN_CHAIN,
            toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
            address(tokenBridge),
            address(0) // wormholeCctp
        );

        // Upgrade the contract.
        vm.prank(makeAddr("owner"));
        nativeRouter.upgradeContract(address(newImplementation));

        // Use mock implementation interface.
        IMockOrderRouter mockRouter = IMockOrderRouter(address(nativeRouter));

        // Verify the new implementation.
        assertEq(mockRouter.getImplementation(), address(newImplementation));
        assertTrue(mockRouter.isUpgraded());
    }

    function testCannotUpgradeContractAgain() public {
        // Deploy new implementation.
        MockOrderRouterImplementation newImplementation = new MockOrderRouterImplementation(
            USDC_ADDRESS,
            MATCHING_ENGINE_CHAIN,
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            CANONICAL_TOKEN_CHAIN,
            toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
            address(tokenBridge),
            address(0) // wormholeCctp
        );

        vm.startPrank(makeAddr("owner"));

        // Upgrade the contract.
        nativeRouter.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        nativeRouter.upgradeContract(address(newImplementation));
    }

    function testCannotUpgradeContractInvalidAddress() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        nativeRouter.upgradeContract(address(0));
    }

    function testCannotUpgradeContractOwnerOnly() public {
        vm.prank(makeAddr("not owner"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        nativeRouter.upgradeContract(address(makeAddr("newImplementation")));
    }

    function testCannotAddEndpointAsRandomCaller() public {
        vm.prank(makeAddr("not owner"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        nativeRouter.addRouterInfo(
            1,
            RouterInfo({
                endpoint: TESTING_FOREIGN_ROUTER_ENDPOINT,
                tokenType: TokenType.Native,
                slippage: TESTING_TARGET_SLIPPAGE
            })
        );
    }

    function testUpdateSlippage() public {
        uint16 nativeChain = 1;
        uint16 cctpChain = 23;

        // Register the target chains.
        _registerTargetChain(nativeRouter, nativeChain, TokenType.Native);
        _registerTargetChain(cctpEnabledRouter, cctpChain, TokenType.Cctp);

        vm.startPrank(makeAddr("owner"));

        nativeRouter.addRouterInfo(
            nativeChain,
            RouterInfo({
                endpoint: TESTING_FOREIGN_ROUTER_ENDPOINT,
                tokenType: TokenType.Native,
                slippage: TESTING_TARGET_SLIPPAGE
            })
        );
        nativeRouter.addRouterInfo(
            cctpChain,
            RouterInfo({
                endpoint: TESTING_FOREIGN_ROUTER_ENDPOINT,
                tokenType: TokenType.Cctp,
                slippage: TESTING_TARGET_SLIPPAGE
            })
        );

        SlippageUpdate[] memory update = new SlippageUpdate[](2);
        update[0] = SlippageUpdate({chain: nativeChain, slippage: 100});
        update[1] = SlippageUpdate({chain: cctpChain, slippage: 100});

        nativeRouter.updateSlippage(update);

        vm.stopPrank();

        // Check that the slippage was updated.
        assertEq(nativeRouter.getRouterInfo(nativeChain).slippage, 100);
        assertEq(nativeRouter.getRouterInfo(cctpChain).slippage, 100);
    }

    function testCannotUpdateSlippageNoUpdate() public {
        vm.expectRevert(abi.encodeWithSignature("ErrNoSlippageUpdate()"));
        vm.prank(makeAddr("owner"));
        nativeRouter.updateSlippage(new SlippageUpdate[](0));
    }

    function testCannotUpdateSlippageOnlyOwnerOrAssistant() public {
        uint16 nativeChain = 1;
        uint16 cctpChain = 23;

        SlippageUpdate[] memory update = new SlippageUpdate[](2);
        update[0] = SlippageUpdate({chain: nativeChain, slippage: 100});
        update[1] = SlippageUpdate({chain: cctpChain, slippage: 100});

        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        vm.prank(makeAddr("not owner"));
        nativeRouter.updateSlippage(update);
    }

    function testUpdateDefaultRelayerFee() public {
        uint256 startingFee = nativeRouter.defaultRelayerFee();
        uint256 newFee = 69;
        assertFalse(startingFee == newFee);

        vm.prank(makeAddr("owner"));
        nativeRouter.updateDefaultRelayerFee(newFee);

        assertEq(nativeRouter.defaultRelayerFee(), newFee);
    }

    function testCannotUpdateDefaultRelayerFeeOnlyOwnerOrAssistant() public {
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        vm.prank(makeAddr("not owner"));
        nativeRouter.updateDefaultRelayerFee(69);
    }

    function testCannotPlaceMarketOrderErrZeroMinAmountOut() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 1,
            minAmountOut: 0,
            targetChain: 1,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrZeroMinAmountOut.selector));
        nativeRouter.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrUnsupportedChain() public {
        uint256 amountIn = 69;

        uint16 targetChain = 2;
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: amountIn,
            targetChain: targetChain,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedChain.selector, targetChain));
        nativeRouter.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrInsufficientAmount() public {
        uint256 amountIn = 69;
        uint256 relayerFee = _computeMinAmountOut(amountIn, 0);

        uint16 targetChain = 1;
        _registerTargetChain(nativeRouter, targetChain, TokenType.Native);

        _dealAndApproveUsdc(nativeRouter, amountIn);

        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: amountIn,
            targetChain: targetChain,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        vm.expectRevert(
            abi.encodeWithSelector(ErrInsufficientAmount.selector, relayerFee, relayerFee)
        );
        nativeRouter.placeMarketOrder(args, relayerFee, new bytes32[](0));
    }

    function testCannotPlaceMarketOrderErrMinAmountOutExceedsLimit() public {
        uint256 amountIn = 69;
        uint256 amountMinusSlippage = _computeMinAmountOut(amountIn, 0);

        uint16 targetChain = 1;
        _registerTargetChain(nativeRouter, targetChain, TokenType.Native);

        _dealAndApproveUsdc(nativeRouter, amountIn);

        uint256 minAmountOut = amountMinusSlippage + 1;

        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrMinAmountOutExceedsLimit.selector,
                minAmountOut,
                amountMinusSlippage
            )
        );
        nativeRouter.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrTooManyRelayers() public {
        uint256 numAllowedRelayers = 9;
        uint256 amountIn = 69420;
        uint256 relayerFee = 69;

        uint16 targetChain = 1;
        _registerTargetChain(nativeRouter, targetChain, TokenType.Native);

        _dealAndApproveUsdc(nativeRouter, amountIn);

        uint256 minAmountOut = _computeMinAmountOut(amountIn, relayerFee);

        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrTooManyRelayers.selector,
                numAllowedRelayers,
                nativeRouter.MAX_NUM_RELAYERS()
            )
        );
        nativeRouter.placeMarketOrder(args, relayerFee, _makeAllowedRelayers(numAllowedRelayers));
    }

    function testPlaceMarketOrderDefaultRelayerFee() public {
        uint256 amountIn = 69420;
        uint256 defaultRelayerFee = 69;

        uint16 targetChain = 1;
        _registerTargetChain(nativeRouter, targetChain, TokenType.Native);

        _dealAndApproveUsdc(nativeRouter, amountIn);

        // Set the default relayer fee.
        vm.prank(makeAddr("owner"));
        nativeRouter.updateDefaultRelayerFee(defaultRelayerFee);

        uint256 minAmountOut = _computeMinAmountOut(amountIn, nativeRouter.defaultRelayerFee());

        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: bytes32(0),
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0)
        });

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        nativeRouter.placeMarketOrder(args);

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        bytes memory payload = wormholeSimulator
            .parseVMFromLogs(wormholeSimulator.fetchWormholeMessageFromLog(logs)[0])
            .payload;

        // Check that the order is correct.
        Messages.MarketOrder memory order = Messages.decodeMarketOrder(
            tokenBridge.parseTransferWithPayload(payload).payload
        );

        assertEq(order.minAmountOut, minAmountOut);
        assertEq(order.targetChain, targetChain);
        assertEq(order.redeemer, bytes32(0));
        assertEq(order.redeemerMessage, args.redeemerMessage);
        assertEq(order.sender, toUniversalAddress(address(this)));
        assertEq(order.refundAddress, toUniversalAddress(args.refundAddress));
        assertEq(order.relayerFee, defaultRelayerFee);
        assertEq(order.allowedRelayers.length, 0);
    }

    function testNativeRouterPlaceMarketOrder(uint256 amountIn, uint8 dstTokenTypeInt) public {
        amountIn = bound(amountIn, 1, _tokenBridgeOutboundLimit());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            dstTokenTypeInt == uint8(TokenType.Native) ||
                dstTokenTypeInt == uint8(TokenType.Canonical) ||
                dstTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 targetChain = 2;
        _registerTargetChain(nativeRouter, targetChain, TokenType(dstTokenTypeInt));

        _dealAndApproveUsdc(nativeRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, 0),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory tokenBridgePayload = _placeMarketOrder(nativeRouter, amountIn, expectedOrder);
        _assertTokenBridgeMarketOrder(
            nativeRouter,
            6,
            USDC_ADDRESS,
            amountIn,
            tokenBridgePayload,
            expectedOrder
        );
    }

    function testNativeRouterPlaceMarketOrderWithRelayerFee(
        uint256 relayerFee,
        uint8 dstTokenTypeInt
    ) public {
        uint256 amountIn = _tokenBridgeOutboundLimit();
        relayerFee = bound(relayerFee, 1, amountIn - 1);
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            dstTokenTypeInt == uint8(TokenType.Native) ||
                dstTokenTypeInt == uint8(TokenType.Canonical) ||
                dstTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 targetChain = 2;
        _registerTargetChain(nativeRouter, targetChain, TokenType(dstTokenTypeInt));

        _dealAndApproveUsdc(nativeRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, relayerFee),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: relayerFee,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory tokenBridgePayload = _placeMarketOrder(nativeRouter, amountIn, expectedOrder);
        _assertTokenBridgeMarketOrder(
            nativeRouter,
            6,
            USDC_ADDRESS,
            amountIn,
            tokenBridgePayload,
            expectedOrder
        );
    }

    function testNativeRouterPlaceMarketOrderWithAllowedRelayers(
        uint256 numAllowedRelayers,
        uint8 dstTokenTypeInt
    ) public {
        numAllowedRelayers = bound(numAllowedRelayers, 0, 8);
        uint256 amountIn = _tokenBridgeOutboundLimit();
        uint256 relayerFee = amountIn / 2;
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            dstTokenTypeInt == uint8(TokenType.Native) ||
                dstTokenTypeInt == uint8(TokenType.Canonical) ||
                dstTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 targetChain = 2;
        _registerTargetChain(nativeRouter, targetChain, TokenType(dstTokenTypeInt));

        _dealAndApproveUsdc(nativeRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, relayerFee),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: relayerFee,
            allowedRelayers: _makeAllowedRelayers(numAllowedRelayers)
        });

        // Check that the payload is correct.
        bytes memory tokenBridgePayload = _placeMarketOrder(nativeRouter, amountIn, expectedOrder);
        _assertTokenBridgeMarketOrder(
            nativeRouter,
            6,
            USDC_ADDRESS,
            amountIn,
            tokenBridgePayload,
            expectedOrder
        );
    }

    function testCctpEnabledRouterCannotPlaceMarketOrderTargetCctpErrInsufficientAmount() public {
        uint16 targetChain = 2;
        _registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Cctp);

        uint256 amountIn = 0;
        uint256 minAmountOut = amountIn + 1;
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            refundAddress: address(0)
        });

        vm.expectRevert(
            abi.encodeWithSelector(ErrInsufficientAmount.selector, amountIn, minAmountOut)
        );
        cctpEnabledRouter.placeMarketOrder(args);
    }

    function testCctpEnabledRouterPlaceMarketOrderTargetCctp(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, _cctpBurnLimit());

        uint16 targetChain = 2;
        _registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Cctp);

        _dealAndApproveUsdc(cctpEnabledRouter, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: cctpEnabledRouter.wormholeChainId(),
            orderSender: toUniversalAddress(address(this)),
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Check that the payload is correct.
        //
        // NOTE: This is a special case where we send a fill directly to another order router.
        bytes memory wormholeCctpPayload = _placeMarketOrder(
            cctpEnabledRouter,
            amountIn,
            targetChain,
            expectedFill
        );
        ICircleIntegration.DepositWithPayload memory deposit = wormholeCctp
            .decodeDepositWithPayload(wormholeCctpPayload);

        // Check that the market order is encoded correctly.
        assertEq(deposit.payload, expectedFill.encode());

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
                token: toUniversalAddress(USDC_ADDRESS),
                amount: amountIn,
                sourceDomain: wormholeCctp.localDomain(),
                targetDomain: wormholeCctp.getDomainFromChainId(targetChain),
                nonce: deposit.nonce, // This nonce comes from Circle's bridge.
                fromAddress: toUniversalAddress(address(cctpEnabledRouter)),
                mintRecipient: cctpEnabledRouter.getRouterInfo(targetChain).endpoint,
                payload: deposit.payload
            });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testCctpEnabledRouterPlaceMarketOrderTargetNative(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, _cctpBurnLimit());

        uint16 targetChain = 5;
        _registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Native);

        _dealAndApproveUsdc(cctpEnabledRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, 0),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory wormholeCctpPayload = _placeMarketOrder(
            cctpEnabledRouter,
            amountIn,
            expectedOrder
        );
        _assertWormholeCctpMarketOrder(
            cctpEnabledRouter,
            amountIn,
            wormholeCctpPayload,
            expectedOrder
        );
    }

    function testCctpEnabledRouterPlaceMarketOrderTargetCanonical(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, _cctpBurnLimit());

        uint16 targetChain = 23;
        _registerTargetChain(cctpEnabledRouter, targetChain, TokenType.Canonical);

        _dealAndApproveUsdc(cctpEnabledRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, 0),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory wormholeCctpPayload = _placeMarketOrder(
            cctpEnabledRouter,
            amountIn,
            expectedOrder
        );
        _assertWormholeCctpMarketOrder(
            cctpEnabledRouter,
            amountIn,
            wormholeCctpPayload,
            expectedOrder
        );
    }

    function testCanonicalEnabledRouterCannotPlaceMarketOrderTargetCanonicalErrInsufficientAmount()
        public
    {
        uint16 targetChain = 23;
        _registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Canonical);

        uint256 amountIn = 0;
        uint256 minAmountOut = amountIn + 1;
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            refundAddress: address(0)
        });

        vm.expectRevert(
            abi.encodeWithSelector(ErrInsufficientAmount.selector, amountIn, minAmountOut)
        );
        canonicalEnabledRouter.placeMarketOrder(args);
    }

    function testCanonicalEnabledRouterPlaceMarketOrderTargetCanonical1(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, canonicalEnabledRouter.MAX_AMOUNT());

        uint16 targetChain = 21;
        _registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Canonical);

        _dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: cctpEnabledRouter.wormholeChainId(),
            orderSender: toUniversalAddress(address(this)),
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Check that the payload is correct.
        //
        // NOTE: This is a special case where we send a fill directly to another order router.
        bytes memory tokenBridgePayload = _placeMarketOrder(
            canonicalEnabledRouter,
            amountIn,
            targetChain,
            expectedFill
        );
        ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
            tokenBridgePayload
        );

        assertEq(transfer.payload, expectedFill.encode());

        ITokenBridge.TransferWithPayload memory expectedTransfer = ITokenBridge
            .TransferWithPayload({
                payloadID: 3,
                amount: amountIn,
                tokenAddress: toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
                tokenChain: CANONICAL_TOKEN_CHAIN,
                to: canonicalEnabledRouter.getRouterInfo(targetChain).endpoint,
                toChain: targetChain,
                fromAddress: toUniversalAddress(address(canonicalEnabledRouter)),
                payload: transfer.payload
            });
        assertEq(keccak256(abi.encode(transfer)), keccak256(abi.encode(expectedTransfer)));
    }

    function testCanonicalEnabledRouterPlaceMarketOrderTargetCanonical2(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, canonicalEnabledRouter.MAX_AMOUNT());

        uint16 targetChain = 2;
        _registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Cctp);

        _dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: cctpEnabledRouter.wormholeChainId(),
            orderSender: toUniversalAddress(address(this)),
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Check that the payload is correct.
        //
        // NOTE: This is a special case where we send a fill directly to another order router.
        bytes memory tokenBridgePayload = _placeMarketOrder(
            canonicalEnabledRouter,
            amountIn,
            targetChain,
            expectedFill
        );
        ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
            tokenBridgePayload
        );

        assertEq(transfer.payload, expectedFill.encode());

        ITokenBridge.TransferWithPayload memory expectedTransfer = ITokenBridge
            .TransferWithPayload({
                payloadID: 3,
                amount: amountIn,
                tokenAddress: toUniversalAddress(CANONICAL_TOKEN_ADDRESS),
                tokenChain: CANONICAL_TOKEN_CHAIN,
                to: canonicalEnabledRouter.getRouterInfo(targetChain).endpoint,
                toChain: targetChain,
                fromAddress: toUniversalAddress(address(canonicalEnabledRouter)),
                payload: transfer.payload
            });
        assertEq(keccak256(abi.encode(transfer)), keccak256(abi.encode(expectedTransfer)));
    }

    function testCanonicalEnabledRouterPlaceMarketOrderTargetNative(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, canonicalEnabledRouter.MAX_AMOUNT());

        uint16 targetChain = 5;
        _registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Native);

        _dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, 0),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory tokenBridgePayload = _placeMarketOrder(
            canonicalEnabledRouter,
            amountIn,
            expectedOrder
        );
        _assertTokenBridgeMarketOrder(
            canonicalEnabledRouter,
            CANONICAL_TOKEN_CHAIN,
            CANONICAL_TOKEN_ADDRESS,
            amountIn,
            tokenBridgePayload,
            expectedOrder
        );
    }

    function testCanonicalEnabledRouterPlaceMarketOrderTargetCctp(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, canonicalEnabledRouter.MAX_AMOUNT());

        uint16 targetChain = 69;
        _registerTargetChain(canonicalEnabledRouter, targetChain, TokenType.Cctp);

        _dealAndApproveWrappedUsdc(canonicalEnabledRouter, amountIn);

        Messages.MarketOrder memory expectedOrder = Messages.MarketOrder({
            minAmountOut: _computeMinAmountOut(amountIn, 0),
            targetChain: targetChain,
            redeemer: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemerMessage: bytes("All your base are belong to us"),
            sender: toUniversalAddress(address(this)),
            refundAddress: _makeRefundAddress(),
            relayerFee: 0,
            allowedRelayers: new bytes32[](0)
        });

        // Check that the payload is correct.
        bytes memory tokenBridgePayload = _placeMarketOrder(
            canonicalEnabledRouter,
            amountIn,
            expectedOrder
        );
        _assertTokenBridgeMarketOrder(
            canonicalEnabledRouter,
            CANONICAL_TOKEN_CHAIN,
            CANONICAL_TOKEN_ADDRESS,
            amountIn,
            tokenBridgePayload,
            expectedOrder
        );
    }

    function testCannotRedeemFillErrUnsupportedChain() public {
        uint16 senderChain = 3;

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN,
            fill.encode()
        );

        vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedChain.selector, senderChain));
        nativeRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemFillErrSourceNotMatchingEngine1() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        bytes32 emitterAddress = toUniversalAddress(makeAddr("not matching engine"));
        assertNotEq(emitterAddress, toUniversalAddress(MATCHING_ENGINE_ADDRESS));

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            emitterAddress,
            MATCHING_ENGINE_CHAIN,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrSourceNotMatchingEngine.selector,
                MATCHING_ENGINE_CHAIN,
                emitterAddress
            )
        );
        nativeRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemFillErrSourceNotMatchingEngine2() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        uint16 emitterChain = 3;
        assertNotEq(emitterChain, MATCHING_ENGINE_CHAIN);

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            emitterChain,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrSourceNotMatchingEngine.selector,
                emitterChain,
                toUniversalAddress(MATCHING_ENGINE_ADDRESS)
            )
        );
        nativeRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemFillErrInvalidRedeemer() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        bytes32 expectedRedeemer = toUniversalAddress(makeAddr("someone else"));
        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: expectedRedeemer,
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidRedeemer.selector,
                toUniversalAddress(address(this)),
                expectedRedeemer
            )
        );
        nativeRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemFillInvalidPayloadId() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: RevertType.SwapFailed,
            refundAddress: _makeRefundAddress(),
            redeemer: toUniversalAddress(address(this))
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN,
            orderRevert.encode()
        );

        vm.expectRevert(abi.encodeWithSignature("InvalidPayloadId(uint8,uint8)", 0x20, 0x10));
        nativeRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemOrderRevertInvalidPayloadId() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN,
            fill.encode()
        );

        vm.expectRevert(abi.encodeWithSignature("InvalidPayloadId(uint8,uint8)", 0x10, 0x20));
        nativeRouter.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemOrderRevertErrSourceNotMatchingEngine1() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: RevertType.SwapFailed,
            refundAddress: _makeRefundAddress(),
            redeemer: toUniversalAddress(address(this))
        });

        bytes32 emitterAddress = toUniversalAddress(makeAddr("not matching engine"));
        assertNotEq(emitterAddress, toUniversalAddress(MATCHING_ENGINE_ADDRESS));

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            emitterAddress,
            MATCHING_ENGINE_CHAIN,
            orderRevert.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrSourceNotMatchingEngine.selector,
                MATCHING_ENGINE_CHAIN,
                emitterAddress
            )
        );
        nativeRouter.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemOrderRevertErrSourceNotMatchingEngine2() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: RevertType.SwapFailed,
            refundAddress: _makeRefundAddress(),
            redeemer: toUniversalAddress(address(this))
        });

        uint16 emitterChain = 3;
        assertNotEq(emitterChain, MATCHING_ENGINE_CHAIN);

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            emitterChain,
            orderRevert.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrSourceNotMatchingEngine.selector,
                emitterChain,
                toUniversalAddress(MATCHING_ENGINE_ADDRESS)
            )
        );
        nativeRouter.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testCannotRedeemOrderRevertErrInvalidRedeemer() public {
        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType.Native);

        bytes32 expectedRedeemer = toUniversalAddress(makeAddr("someone else"));
        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: RevertType.SwapFailed,
            refundAddress: _makeRefundAddress(),
            redeemer: expectedRedeemer
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            nativeRouter,
            69, // amount
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN,
            orderRevert.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidRedeemer.selector,
                toUniversalAddress(address(this)),
                expectedRedeemer
            )
        );
        nativeRouter.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
    }

    function testNativeRouterRedeemFill(uint256 amount, uint8 srcTokenTypeInt) public {
        amount = bound(amount, 0, _tokenBridgeInboundLimit());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            srcTokenTypeInt == uint8(TokenType.Native) ||
                srcTokenTypeInt == uint8(TokenType.Canonical) ||
                srcTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType(srcTokenTypeInt));

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            senderChain: senderChain,
            token: address(nativeRouter.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemTokenBridgeFill(
            nativeRouter,
            expectedRedeemed,
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN
        );
    }

    function testNativeRouterRedeemOrderRevert(uint256 refundAmount, uint8 srcTokenTypeInt) public {
        refundAmount = bound(refundAmount, 0, _tokenBridgeInboundLimit());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            srcTokenTypeInt == uint8(TokenType.Native) ||
                srcTokenTypeInt == uint8(TokenType.Canonical) ||
                srcTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 senderChain = 1;
        _registerTargetChain(nativeRouter, senderChain, TokenType(srcTokenTypeInt));

        _redeemTokenBridgeOrderRevert(
            nativeRouter,
            refundAmount,
            RevertType.SwapFailed,
            USDC_ADDRESS,
            nativeRouter.wormholeChainId(),
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN
        );
    }

    function testCctpEnabledRouterCannotRedeemFillErrInvalidSourceRouter1() public {
        uint16 senderChain = 1;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType.Cctp);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        uint16 emitterChain = 23;
        assertNotEq(emitterChain, senderChain);

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            cctpEnabledRouter,
            69, // amount
            TESTING_FOREIGN_ROUTER_ENDPOINT,
            emitterChain,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidSourceRouter.selector,
                emitterChain,
                TokenType.Cctp,
                TESTING_FOREIGN_ROUTER_ENDPOINT
            )
        );
        cctpEnabledRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
    }

    function testCctpEnabledRouterCannotRedeemFillErrInvalidSourceRouter2() public {
        uint16 senderChain = 23;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType.Native);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            cctpEnabledRouter,
            69, // amount
            TESTING_FOREIGN_ROUTER_ENDPOINT,
            senderChain,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidSourceRouter.selector,
                senderChain,
                TokenType.Native,
                TESTING_FOREIGN_ROUTER_ENDPOINT
            )
        );
        cctpEnabledRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
    }

    function testCctpEnabledRouterCannotRedeemFillErrInvalidSourceRouter3() public {
        uint16 senderChain = 23;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType.Cctp);

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: senderChain,
            orderSender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        bytes32 fromAddress = toUniversalAddress(makeAddr("unrecognized sender"));
        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            cctpEnabledRouter,
            69, // amount
            fromAddress,
            senderChain,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidSourceRouter.selector,
                senderChain,
                TokenType.Cctp,
                fromAddress
            )
        );
        cctpEnabledRouter.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
    }

    function testCctpEnabledRouterRedeemOrderRevert(
        uint256 refundAmount,
        uint8 srcTokenTypeInt
    ) public {
        refundAmount = bound(refundAmount, 1, _cctpMintLimit());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            srcTokenTypeInt == uint8(TokenType.Native) ||
                srcTokenTypeInt == uint8(TokenType.Canonical) ||
                srcTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 senderChain = 1;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType(srcTokenTypeInt));

        _redeemWormholeCctpOrderRevert(
            cctpEnabledRouter,
            refundAmount,
            RevertType.SwapFailed,
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN
        );
    }

    function testCctpEnabledRouterRedeemFillFromMatchingEngine(
        uint256 amount,
        uint8 srcTokenTypeInt
    ) public {
        amount = bound(amount, 1, _cctpMintLimit());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            srcTokenTypeInt == uint8(TokenType.Native) ||
                srcTokenTypeInt == uint8(TokenType.Canonical) ||
                srcTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 senderChain = 1;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType(srcTokenTypeInt));

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            senderChain: senderChain,
            token: address(cctpEnabledRouter.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemWormholeCctpFill(
            cctpEnabledRouter,
            expectedRedeemed,
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN
        );
    }

    function testCctpEnabledRouterRedeemFillFromCctpEnabledRouter(uint256 amount) public {
        amount = bound(amount, 1, _cctpMintLimit());

        uint16 senderChain = 23;
        _registerTargetChain(cctpEnabledRouter, senderChain, TokenType.Cctp);

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            senderChain: senderChain,
            token: address(cctpEnabledRouter.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemWormholeCctpFill(
            cctpEnabledRouter,
            expectedRedeemed,
            TESTING_FOREIGN_ROUTER_ENDPOINT,
            senderChain
        );
    }

    function testCanonicalEnabledRouterRedeemFillFromMatchingEngine(
        uint256 amount,
        uint8 srcTokenTypeInt
    ) public {
        amount = bound(amount, 0, UINT256_MAX - IERC20(_wrappedUsdc()).totalSupply());
        // This is a hack because forge tests cannot fuzz test enums yet.
        vm.assume(
            srcTokenTypeInt == uint8(TokenType.Native) ||
                srcTokenTypeInt == uint8(TokenType.Canonical) ||
                srcTokenTypeInt == uint8(TokenType.Cctp)
        );

        uint16 senderChain = 1;
        _registerTargetChain(canonicalEnabledRouter, senderChain, TokenType(srcTokenTypeInt));

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            senderChain: senderChain,
            token: address(canonicalEnabledRouter.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemTokenBridgeFill(
            canonicalEnabledRouter,
            expectedRedeemed,
            CANONICAL_TOKEN_ADDRESS,
            CANONICAL_TOKEN_CHAIN,
            toUniversalAddress(MATCHING_ENGINE_ADDRESS),
            MATCHING_ENGINE_CHAIN
        );
    }

    function testCanonicalEnabledRouterRedeemFillFromCanonicalEnabledRouter(uint256 amount) public {
        amount = bound(amount, 0, UINT256_MAX - IERC20(_wrappedUsdc()).totalSupply());

        uint16 senderChain = 23;
        _registerTargetChain(canonicalEnabledRouter, senderChain, TokenType.Canonical);

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: 0x1337133713371337133713371337133713371337133713371337133713371337,
            senderChain: senderChain,
            token: address(canonicalEnabledRouter.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemTokenBridgeFill(
            canonicalEnabledRouter,
            expectedRedeemed,
            CANONICAL_TOKEN_ADDRESS,
            CANONICAL_TOKEN_CHAIN,
            TESTING_FOREIGN_ROUTER_ENDPOINT,
            senderChain
        );
    }

    function _dealAndApproveUsdc(IOrderRouter router, uint256 amount) internal {
        deal(USDC_ADDRESS, address(this), amount);
        IERC20(USDC_ADDRESS).approve(address(router), amount);
    }

    function _registerTargetChain(IOrderRouter router, uint16 chain, TokenType tokenType) internal {
        vm.prank(makeAddr("owner"));
        router.addRouterInfo(
            chain,
            RouterInfo({
                endpoint: TESTING_FOREIGN_ROUTER_ENDPOINT,
                tokenType: tokenType,
                slippage: TESTING_TARGET_SLIPPAGE
            })
        );
    }

    function _cctpBurnLimit() internal returns (uint256 limit) {
        limit = wormholeCctp.circleBridge().localMinter().burnLimitsPerMessage(USDC_ADDRESS);

        // Having this check prevents us forking a network where Circle has not set a burn limit.
        assertGt(limit, 0);
    }

    function _wrappedUsdc() internal view returns (address) {
        return
            ITokenBridge(TOKEN_BRIDGE_ADDRESS).wrappedAsset(
                CANONICAL_TOKEN_CHAIN,
                bytes32(uint256(uint160(CANONICAL_TOKEN_ADDRESS)))
            );
    }

    function _dealAndApproveWrappedUsdc(IOrderRouter router, uint256 amount) internal {
        // First deal amount to this contract.
        deal(_wrappedUsdc(), address(this), amount);

        // Total supply is stored in slot 3. We need the supply of the Token Bridge wrapped USDC to
        // reflect however much we dealt. Otherwise we get arithmetic errors when Token Bridge tries
        // to burn its assets.
        vm.store(_wrappedUsdc(), bytes32(uint256(3)), bytes32(amount));
        assertEq(IERC20(_wrappedUsdc()).totalSupply(), amount);

        // Approve the router for spending.
        IERC20(_wrappedUsdc()).approve(address(router), amount);
    }

    function _placeMarketOrder(
        IOrderRouter router,
        uint256 amountIn,
        Messages.MarketOrder memory expectedOrder
    ) internal returns (bytes memory) {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: expectedOrder.minAmountOut,
            targetChain: expectedOrder.targetChain,
            redeemer: expectedOrder.redeemer,
            redeemerMessage: expectedOrder.redeemerMessage,
            refundAddress: fromUniversalAddress(expectedOrder.refundAddress)
        });

        return
            _placeMarketOrder(
                router,
                args,
                expectedOrder.relayerFee,
                expectedOrder.allowedRelayers
            );
    }

    function _placeMarketOrder(
        IOrderRouter router,
        uint256 amountIn,
        uint16 targetChain,
        Messages.Fill memory expectedFill
    ) internal returns (bytes memory) {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: amountIn,
            targetChain: targetChain,
            redeemer: expectedFill.redeemer,
            redeemerMessage: expectedFill.redeemerMessage,
            refundAddress: makeAddr("Where's my money?")
        });

        return _placeMarketOrder(router, args, 0, new bytes32[](0));
    }

    function _placeMarketOrder(
        IOrderRouter router,
        PlaceMarketOrderArgs memory args,
        uint256 relayerFee,
        bytes32[] memory allowedRelayers
    ) internal returns (bytes memory) {
        // Grab balance.
        uint256 balanceBefore = router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        router.placeMarketOrder(args, relayerFee, allowedRelayers);

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        // Finally balance check.
        assertEq(router.orderToken().balanceOf(address(this)) + args.amountIn, balanceBefore);

        return
            wormholeSimulator
                .parseVMFromLogs(wormholeSimulator.fetchWormholeMessageFromLog(logs)[0])
                .payload;
    }

    function _assertTokenBridgeMarketOrder(
        IOrderRouter router,
        uint16 tokenChain,
        address tokenAddress,
        uint256 amountIn,
        bytes memory wormholePayload,
        Messages.MarketOrder memory expectedOrder
    ) internal {
        ITokenBridge.TransferWithPayload memory transfer = tokenBridge.parseTransferWithPayload(
            wormholePayload
        );

        // Check that the market order is encoded correctly.
        assertEq(transfer.payload, expectedOrder.encode());

        // And check that the transfer is encoded correctly.
        ITokenBridge.TransferWithPayload memory expectedTransfer = ITokenBridge
            .TransferWithPayload({
                payloadID: 3,
                amount: amountIn,
                tokenAddress: toUniversalAddress(tokenAddress),
                tokenChain: tokenChain,
                to: toUniversalAddress(MATCHING_ENGINE_ADDRESS),
                toChain: MATCHING_ENGINE_CHAIN,
                fromAddress: toUniversalAddress(address(router)),
                payload: transfer.payload
            });
        assertEq(keccak256(abi.encode(transfer)), keccak256(abi.encode(expectedTransfer)));
    }

    function _assertWormholeCctpMarketOrder(
        IOrderRouter router,
        uint256 amountIn,
        bytes memory wormholePayload,
        Messages.MarketOrder memory expectedOrder
    ) internal {
        ICircleIntegration.DepositWithPayload memory deposit = wormholeCctp
            .decodeDepositWithPayload(wormholePayload);

        // Check that the market order is encoded correctly.
        assertEq(deposit.payload, expectedOrder.encode());

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
                token: toUniversalAddress(USDC_ADDRESS),
                amount: amountIn,
                sourceDomain: wormholeCctp.localDomain(),
                targetDomain: wormholeCctp.getDomainFromChainId(MATCHING_ENGINE_CHAIN),
                nonce: deposit.nonce, // This nonce comes from Circle's bridge.
                fromAddress: toUniversalAddress(address(router)),
                mintRecipient: toUniversalAddress(MATCHING_ENGINE_ADDRESS),
                payload: deposit.payload
            });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function _makeAllowedRelayers(
        uint256 numAllowedRelayers
    ) internal pure returns (bytes32[] memory) {
        bytes32[] memory allowedRelayers = new bytes32[](numAllowedRelayers);
        for (uint256 i = 0; i < numAllowedRelayers; ++i) {
            allowedRelayers[i] = bytes32(i + 1);
        }
        return allowedRelayers;
    }

    function _computeSlippage(uint256 amountIn) internal returns (uint256) {
        // Must be greater than zero.
        assertGt(amountIn, 0);
        // Must be less than or equal to the max amount.
        assertLe(amountIn, nativeRouter.MAX_AMOUNT());

        return (amountIn * uint256(TESTING_TARGET_SLIPPAGE)) / nativeRouter.MAX_SLIPPAGE();
    }

    function _computeMinAmountOut(uint256 amountIn, uint256 relayerFee) internal returns (uint256) {
        // Must be greater than relayer fee.
        assertGt(amountIn, relayerFee);
        uint256 amountMinusFee = amountIn - relayerFee;
        uint256 slippage = (amountMinusFee * uint256(TESTING_TARGET_SLIPPAGE)) /
            nativeRouter.MAX_SLIPPAGE();
        return amountMinusFee - slippage;
    }

    function _tokenBridgeOutboundLimit() internal returns (uint256) {
        uint256 supplyMinusBridged = IERC20(USDC_ADDRESS).totalSupply() -
            ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS);

        // Must be greater than one, which is the minimum relayer fee for testing.
        assertGt(supplyMinusBridged, 1);
        return
            supplyMinusBridged < nativeRouter.MAX_AMOUNT()
                ? supplyMinusBridged
                : nativeRouter.MAX_AMOUNT();
    }

    function _tokenBridgeInboundLimit() internal returns (uint256) {
        uint256 supply = IERC20(USDC_ADDRESS).totalSupply();
        uint256 amount = supply -
            ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS);

        // First deal max amount to Token Bridge contract.
        deal(USDC_ADDRESS, TOKEN_BRIDGE_ADDRESS, amount);

        // Outstanding bridged amounts are stored in slot 10. We need the outstanding bridged amount
        // for USDC to reflect however much we dealt. Otherwise we get arithmetic errors when Token
        // Bridge tries to complete transfer.
        vm.store(TOKEN_BRIDGE_ADDRESS, keccak256(abi.encode(USDC_ADDRESS, 10)), bytes32(supply));
        assertEq(ITokenBridge(TOKEN_BRIDGE_ADDRESS).outstandingBridged(USDC_ADDRESS), supply);

        return amount;
    }

    function _createSignedVaa(
        uint16 emitterChainId,
        bytes32 emitterAddress,
        bytes memory payload
    ) internal view returns (bytes memory) {
        IWormhole.VM memory vaa = IWormhole.VM({
            version: 1,
            timestamp: 1234567,
            nonce: 0,
            emitterChainId: emitterChainId,
            emitterAddress: emitterAddress,
            sequence: 0,
            consistencyLevel: 1,
            payload: payload,
            guardianSetIndex: wormholeSimulator.currentGuardianSetIndex(),
            signatures: new IWormhole.Signature[](0),
            hash: 0x00
        });

        return wormholeSimulator.encodeAndSignMessage(vaa);
    }

    function _craftTokenBridgeVaa(
        IOrderRouter router,
        uint256 amount,
        address tokenAddress,
        uint16 tokenChain,
        bytes32 fromAddress,
        uint16 fromChain,
        bytes memory encodedMessage
    ) internal returns (bytes memory) {
        bytes32 emitterAddress = tokenBridge.bridgeContracts(fromChain);
        assertNotEq(emitterAddress, bytes32(0));

        return
            _createSignedVaa(
                fromChain,
                emitterAddress,
                tokenBridge.encodeTransferWithPayload(
                    ITokenBridge.TransferWithPayload({
                        payloadID: 3,
                        amount: amount,
                        tokenAddress: toUniversalAddress(tokenAddress),
                        tokenChain: tokenChain,
                        to: toUniversalAddress(address(router)),
                        toChain: router.wormholeChainId(),
                        fromAddress: fromAddress,
                        payload: encodedMessage
                    })
                )
            );
    }

    function _redeemTokenBridgeFill(
        IOrderRouter router,
        RedeemedFill memory expectedRedeemed,
        address tokenAddress,
        uint16 tokenChain,
        bytes32 fromAddress,
        uint16 fromChain
    ) internal {
        Messages.Fill memory fill = Messages.Fill({
            sourceChain: expectedRedeemed.senderChain,
            orderSender: expectedRedeemed.sender,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: expectedRedeemed.message
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            router,
            expectedRedeemed.amount,
            tokenAddress,
            tokenChain,
            fromAddress,
            fromChain,
            fill.encode()
        );

        uint256 balanceBefore = router.orderToken().balanceOf(address(this));

        RedeemedFill memory redeemed = router.redeemFill(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
        assertEq(keccak256(abi.encode(redeemed)), keccak256(abi.encode(expectedRedeemed)));
        assertEq(router.orderToken().balanceOf(address(this)), balanceBefore + redeemed.amount);
    }

    function _redeemTokenBridgeOrderRevert(
        IOrderRouter router,
        uint256 refundAmount,
        RevertType expectedReason,
        address tokenAddress,
        uint16 tokenChain,
        bytes32 fromAddress,
        uint16 fromChain
    ) internal {
        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: expectedReason,
            refundAddress: _makeRefundAddress(),
            redeemer: toUniversalAddress(address(this))
        });

        bytes memory encodedVaa = _craftTokenBridgeVaa(
            router,
            refundAmount,
            tokenAddress,
            tokenChain,
            fromAddress,
            fromChain,
            orderRevert.encode()
        );

        uint256 balanceBefore = router.orderToken().balanceOf(address(this));

        (RevertType reason, address actualRefundAddress) = router.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: "",
                circleAttestation: ""
            })
        );
        assertEq(uint8(reason), uint8(expectedReason));
        assertEq(toUniversalAddress(actualRefundAddress), _makeRefundAddress());
        assertEq(router.orderToken().balanceOf(address(this)), balanceBefore + refundAmount);
    }

    function _makeRefundAddress() internal returns (bytes32) {
        return toUniversalAddress(makeAddr("Where's my money?"));
    }

    function _craftWormholeCctpRedeemParams(
        IOrderRouter router,
        uint256 amount,
        bytes32 fromAddress,
        uint16 fromChain,
        bytes memory encodedMessage
    ) internal returns (ICircleIntegration.RedeemParameters memory) {
        bytes32 emitterAddress = wormholeCctp.getRegisteredEmitter(fromChain);
        assertNotEq(emitterAddress, bytes32(0));

        ICircleIntegration.DepositWithPayload memory deposit = ICircleIntegration
            .DepositWithPayload({
                token: toUniversalAddress(ARBITRUM_USDC_ADDRESS),
                amount: amount,
                sourceDomain: wormholeCctp.getDomainFromChainId(fromChain),
                targetDomain: wormholeCctp.localDomain(),
                nonce: 2 ** 64 - 1,
                fromAddress: fromAddress,
                mintRecipient: toUniversalAddress(address(router)),
                payload: encodedMessage
            });

        bytes memory encodedVaa = _createSignedVaa(
            fromChain,
            emitterAddress,
            wormholeCctp.encodeDepositWithPayload(deposit)
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

        return
            ICircleIntegration.RedeemParameters({
                encodedWormholeMessage: encodedVaa,
                circleBridgeMessage: circleMessage,
                circleAttestation: circleSimulator.attestCircleMessage(circleMessage)
            });
    }

    function _redeemWormholeCctpFill(
        IOrderRouter router,
        RedeemedFill memory expectedRedeemed,
        bytes32 fromAddress,
        uint16 fromChain
    ) internal {
        Messages.Fill memory fill = Messages.Fill({
            sourceChain: expectedRedeemed.senderChain,
            orderSender: expectedRedeemed.sender,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: expectedRedeemed.message
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            expectedRedeemed.amount,
            fromAddress,
            fromChain,
            fill.encode()
        );

        uint256 balanceBefore = router.orderToken().balanceOf(address(this));

        RedeemedFill memory redeemed = router.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
        assertEq(keccak256(abi.encode(redeemed)), keccak256(abi.encode(expectedRedeemed)));
        assertEq(router.orderToken().balanceOf(address(this)), balanceBefore + redeemed.amount);
    }

    function _redeemWormholeCctpOrderRevert(
        IOrderRouter router,
        uint256 refundAmount,
        RevertType expectedReason,
        bytes32 fromAddress,
        uint16 fromChain
    ) internal {
        Messages.OrderRevert memory orderRevert = Messages.OrderRevert({
            reason: expectedReason,
            refundAddress: _makeRefundAddress(),
            redeemer: toUniversalAddress(address(this))
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            refundAmount,
            fromAddress,
            fromChain,
            orderRevert.encode()
        );

        uint256 balanceBefore = router.orderToken().balanceOf(address(this));

        (RevertType reason, address actualRefundAddress) = router.redeemOrderRevert(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
        assertEq(uint8(reason), uint8(expectedReason));
        assertEq(toUniversalAddress(actualRefundAddress), _makeRefundAddress());
        assertEq(router.orderToken().balanceOf(address(this)), balanceBefore + refundAmount);
    }

    function _cctpMintLimit() internal returns (uint256 limit) {
        // This is a hack, assuming the burn limit == mint limit.
        return _cctpBurnLimit();
    }
}
