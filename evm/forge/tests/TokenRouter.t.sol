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
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";

import {
    IMockTokenRouter,
    MockTokenRouterImplementation
} from "./helpers/mock/MockTokenRouterImplementation.sol";

import "../../src/TokenRouter/assets/Errors.sol";
import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";
import {TokenRouterSetup} from "../../src/TokenRouter/TokenRouterSetup.sol";

import {Messages} from "../../src/shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import "../../src/interfaces/ITokenRouter.sol";
import {FastTransferParameters} from "../../src/interfaces/ITokenRouterTypes.sol";

contract TokenRouterTest is Test {
    using BytesParsing for bytes;
    using Messages for *;

    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant WORMHOLE_CCTP_ADDRESS = 0x09Fb06A271faFf70A651047395AaEb6265265F13;
    address constant TOKEN_BRIDGE_ADDRESS = 0x0e082F06FF657D94310cB8cE8B0D9a04541d8052;
    uint16 constant ARB_CHAIN = 23;
    uint16 constant AVAX_CHAIN = 6;

    // Environment variables.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    bytes32 immutable CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("AVAX_CIRCLE_BRIDGE"));
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");

    bytes32 immutable FOREIGN_CIRCLE_BRIDGE = toUniversalAddress(vm.envAddress("ARB_CIRCLE_BRIDGE"));
    bytes32 immutable FOREIGN_WORMHOLE_CCTP =
        toUniversalAddress(vm.envAddress("ARB_CIRCLE_INTEGRATION"));

    bytes32 immutable TEST_REDEEMER = toUniversalAddress(makeAddr("TEST_REDEEMER"));

    // Fast transfer parameters.
    uint128 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint128 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint128 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Test routers.
    ITokenRouter router;
    bytes32 immutable ARB_ROUTER = toUniversalAddress(makeAddr("arbRouter"));

    // Matching engine.
    uint16 immutable matchingEngineChain = 2; // Let's pretend the matching engine is on ETH.
    bytes32 immutable matchingEngineAddress = toUniversalAddress(makeAddr("ME"));

    // Integrating contract helpers.
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;

    // Convenient interfaces.
    ICircleIntegration wormholeCctp;

    function deployProxy(address _token, address _wormholeCircle) internal returns (ITokenRouter) {
        // Deploy Implementation.
        TokenRouterImplementation implementation = new TokenRouterImplementation(
            _token, _wormholeCircle, matchingEngineChain, matchingEngineAddress
        );

        // Deploy Setup.
        TokenRouterSetup setup = new TokenRouterSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        return ITokenRouter(proxy);
    }

    function setUp() public {
        wormholeCctp = ICircleIntegration(WORMHOLE_CCTP_ADDRESS);

        // Set up token routers. These routers will represent the different outbound paths.
        vm.startPrank(makeAddr("owner"));
        router = deployProxy(USDC_ADDRESS, address(wormholeCctp));

        // Register target chain endpoints.
        router.addRouterEndpoint(ARB_CHAIN, ARB_ROUTER);

        // Set the fast transfer parameters for Arbitrum.
        router.updateFastTransferParameters(
            FastTransferParameters({
                enabled: true,
                maxAmount: FAST_TRANSFER_MAX_AMOUNT,
                baseFee: FAST_TRANSFER_BASE_FEE,
                initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
            })
        );

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
        MockTokenRouterImplementation newImplementation = new MockTokenRouterImplementation(
            USDC_ADDRESS, address(wormholeCctp), matchingEngineChain, matchingEngineAddress
        );

        // Upgrade the contract.
        vm.prank(makeAddr("owner"));
        router.upgradeContract(address(newImplementation));

        // Use mock implementation interface.
        IMockTokenRouter mockRouter = IMockTokenRouter(address(router));

        // Verify the new implementation.
        assertEq(mockRouter.getImplementation(), address(newImplementation));
        assertTrue(mockRouter.isUpgraded());
    }

    function testCannotUpgradeContractAgain() public {
        // Deploy new implementation.
        MockTokenRouterImplementation newImplementation = new MockTokenRouterImplementation(
            USDC_ADDRESS, address(wormholeCctp), matchingEngineChain, matchingEngineAddress
        );

        vm.startPrank(makeAddr("owner"));

        // Upgrade the contract.
        router.upgradeContract(address(newImplementation));

        vm.expectRevert(abi.encodeWithSignature("AlreadyInitialized()"));
        router.upgradeContract(address(newImplementation));
    }

    function testCannotUpgradeContractInvalidAddress() public {
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        router.upgradeContract(address(0));
    }

    function testCannotUpgradeContractOwnerOnly() public {
        vm.prank(makeAddr("not owner"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        router.upgradeContract(address(makeAddr("newImplementation")));
    }

    function testSetPause() public {
        vm.startPrank(makeAddr("owner"));

        // Check initial pause state.
        {
            bool paused = router.isPaused();
            assertEq(paused, false);
        }

        // Pause the contract.
        {
            router.setPause(true);

            bool paused = router.isPaused();
            assertEq(paused, true);
        }

        // Unpause the contract.
        {
            router.setPause(false);

            bool paused = router.isPaused();
            assertEq(paused, false);
        }
        vm.stopPrank();

        // Pause as assistant.
        {
            vm.prank(makeAddr("ownerAssistant"));
            router.setPause(true);

            bool paused = router.isPaused();
            assertEq(paused, true);
        }
    }

    function testSubmitOwnershipTransferRequest() public {
        vm.startPrank(makeAddr("owner"));

        address newOwner = makeAddr("newOwner");

        // Check initial ownership state.
        {
            address owner = router.getOwner();
            assertEq(owner, makeAddr("owner"));

            address pendingOwner = router.getPendingOwner();
            assertEq(pendingOwner, address(0));
        }

        // Submit the ownership transfer request.
        {
            router.submitOwnershipTransferRequest(newOwner);

            address pendingOwner = router.getPendingOwner();
            assertEq(pendingOwner, newOwner);
        }

        vm.stopPrank();
    }

    function testCannotSubmitOwnershipTransferRequestInvalidAddress() public {
        address newOwner = address(0);

        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        vm.prank(makeAddr("owner"));
        router.submitOwnershipTransferRequest(newOwner);
    }

    function testCannotSubmitOwnershipTransferRequestOwnerOnly() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        router.submitOwnershipTransferRequest(newOwner);
    }

    function testCancelOwnershipTransferRequest() public {
        vm.startPrank(makeAddr("owner"));
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        router.submitOwnershipTransferRequest(newOwner);

        // Cancel the ownership transfer request.
        router.cancelOwnershipTransferRequest();

        address pendingOwner = router.getPendingOwner();
        assertEq(pendingOwner, address(0));

        vm.stopPrank();
    }

    function testCannotCancelOwnershipTransferRequestOwnerOnly() public {
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        vm.prank(makeAddr("owner"));
        router.submitOwnershipTransferRequest(newOwner);

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        router.cancelOwnershipTransferRequest();
    }

    function testConfirmOwnershipTransferRequest() public {
        address newOwner = makeAddr("newOwner");

        // Verify current owner.
        assertEq(router.getOwner(), makeAddr("owner"));

        // Submit the ownership transfer request.
        vm.prank(makeAddr("owner"));
        router.submitOwnershipTransferRequest(newOwner);

        // Confirm by pranking with the newOwner address.
        vm.prank(newOwner);
        router.confirmOwnershipTransferRequest();

        assertEq(router.getOwner(), newOwner);
        assertEq(router.getPendingOwner(), address(0));
    }

    function testCannotConfirmOwnershipTransferRequestNotPendingOwner() public {
        address newOwner = makeAddr("newOwner");

        // Submit the ownership transfer request.
        vm.prank(makeAddr("owner"));
        router.submitOwnershipTransferRequest(newOwner);

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotPendingOwner()"));
        router.confirmOwnershipTransferRequest();
    }

    function testUpdateOwnerAssistant() public {
        address newAssistant = makeAddr("newAssistant");

        vm.prank(makeAddr("owner"));
        router.updateOwnerAssistant(newAssistant);
        assertEq(router.getOwnerAssistant(), newAssistant);
    }

    function testCannotUpdateOwnerAssistantInvalidAddress() public {
        address newAssistant = address(0);

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("InvalidAddress()"));
        router.updateOwnerAssistant(newAssistant);
    }

    function testCannotUpdateOwnerAssistantOwnerOnly() public {
        address newAssistant = makeAddr("newAssistant");

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwner()"));
        router.updateOwnerAssistant(newAssistant);
    }

    function testAddRouterEndpoint() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        assertEq(router.getRouter(chain), bytes32(0));

        vm.prank(makeAddr("owner"));
        router.addRouterEndpoint(chain, routerEndpoint);

        assertEq(router.getRouter(chain), routerEndpoint);
    }

    function testCannotAddRouterEndpointChainIdZero() public {
        uint16 chain = 0;
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        router.addRouterEndpoint(chain, routerEndpoint);
    }

    function testCannotAddRouterEndpointThisChain() public {
        uint16 chain = router.wormholeChainId();
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        router.addRouterEndpoint(chain, routerEndpoint);
    }

    function testCannotAddRouterEndpointInvalidEndpoint() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = bytes32(0);

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEndpoint(bytes32)", routerEndpoint));
        router.addRouterEndpoint(chain, routerEndpoint);
    }

    function testCannotAddRouterEndpointOwnerOrAssistantOnly() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = toUniversalAddress(makeAddr("newRouter"));

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.addRouterEndpoint(chain, routerEndpoint);
    }

    function testUpdateFastTransferParameters() public {
        FastTransferParameters memory newParams = FastTransferParameters({
            enabled: true,
            maxAmount: 420,
            baseFee: 100,
            initAuctionFee: 10
        });

        // Fetch current parameters.
        FastTransferParameters memory currentParams = router.getFastTransferParameters();
        assertEq(currentParams.enabled, true);
        assertEq(currentParams.maxAmount, FAST_TRANSFER_MAX_AMOUNT);
        assertEq(currentParams.baseFee, FAST_TRANSFER_BASE_FEE);
        assertEq(currentParams.initAuctionFee, FAST_TRANSFER_INIT_AUCTION_FEE);

        // Update to the new params.
        vm.prank(makeAddr("owner"));
        router.updateFastTransferParameters(newParams);

        FastTransferParameters memory params = router.getFastTransferParameters();
        assertEq(params.enabled, newParams.enabled);
        assertEq(params.maxAmount, newParams.maxAmount);
        assertEq(params.baseFee, newParams.baseFee);
        assertEq(params.initAuctionFee, newParams.initAuctionFee);
    }

    function testCannotUpdateFastTransferParametersInvalidMaxAmount() public {
        // Set `feeInBps` to one larger than the max (defined in `State.sol`).
        FastTransferParameters memory newParams = FastTransferParameters({
            enabled: true,
            maxAmount: 200,
            baseFee: 101,
            initAuctionFee: 101
        });

        // Update to the new params.
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidFastTransferParameters()"));
        router.updateFastTransferParameters(newParams);
    }

    function testCannotUpdateFastTransferParametersOnlyOwnerOrAssistant() public {
        // Set `feeInBps` to one larger than the max (defined in `State.sol`).
        FastTransferParameters memory newParams =
            FastTransferParameters({enabled: true, maxAmount: 100, baseFee: 50, initAuctionFee: 25});

        // Update to the new params.
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.updateFastTransferParameters(newParams);
    }

    function testDisableFastTransfers() public {
        // Fetch current parameters.
        FastTransferParameters memory currentParams = router.getFastTransferParameters();
        assertEq(currentParams.enabled, true);
        assertEq(currentParams.maxAmount, FAST_TRANSFER_MAX_AMOUNT);
        assertEq(currentParams.baseFee, FAST_TRANSFER_BASE_FEE);
        assertEq(currentParams.initAuctionFee, FAST_TRANSFER_INIT_AUCTION_FEE);

        vm.prank(makeAddr("owner"));
        router.enableFastTransfers(false);

        FastTransferParameters memory params = router.getFastTransferParameters();
        assertEq(params.enabled, false);
    }

    function testEnableFastTransfers() public {
        // Fetch current parameters.
        FastTransferParameters memory currentParams = router.getFastTransferParameters();
        assertEq(currentParams.enabled, true);
        assertEq(currentParams.maxAmount, FAST_TRANSFER_MAX_AMOUNT);
        assertEq(currentParams.baseFee, FAST_TRANSFER_BASE_FEE);
        assertEq(currentParams.initAuctionFee, FAST_TRANSFER_INIT_AUCTION_FEE);

        vm.prank(makeAddr("owner"));
        router.enableFastTransfers(false);

        FastTransferParameters memory params = router.getFastTransferParameters();
        assertEq(params.enabled, false);

        vm.prank(makeAddr("owner"));
        router.enableFastTransfers(true);

        params = router.getFastTransferParameters();
        assertEq(params.enabled, true);
    }

    function testCannotDisableFastTransfersOnlyOwnerOrAssistant() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.enableFastTransfers(false);
    }

    /**
     * MESSAGES TESTS
     */

    function testEncodeAndDecodeFill(
        uint16 sourceChain,
        bytes32 orderSender,
        bytes32 redeemer,
        bytes memory redeemerMessage
    ) public {
        Messages.Fill memory fill = Messages.Fill({
            sourceChain: sourceChain,
            orderSender: orderSender,
            redeemer: redeemer,
            redeemerMessage: redeemerMessage
        });

        // Encode and decode the fill.
        bytes memory encoded = fill.encode();

        Messages.Fill memory decoded = Messages.decodeFill(encoded);

        assertEq(decoded.sourceChain, fill.sourceChain);
        assertEq(decoded.orderSender, fill.orderSender);
        assertEq(decoded.redeemer, fill.redeemer);
        assertEq(decoded.redeemerMessage, fill.redeemerMessage);
    }

    function testEncodeAndDecodeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes32 sender,
        bytes32 refundAddress,
        uint64 slowSequence,
        bytes32 slowEmitter,
        uint128 maxFee,
        uint128 initAuctionFee,
        uint32 deadline,
        bytes memory redeemerMessage
    ) public {
        Messages.FastMarketOrder memory order = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            targetChain: targetChain,
            redeemer: redeemer,
            sender: sender,
            refundAddress: refundAddress,
            slowSequence: slowSequence,
            slowEmitter: slowEmitter,
            maxFee: maxFee,
            initAuctionFee: initAuctionFee,
            deadline: deadline,
            redeemerMessage: redeemerMessage
        });

        // Encode and decode the order.
        bytes memory encoded = order.encode();

        Messages.FastMarketOrder memory decoded = Messages.decodeFastMarketOrder(encoded);

        assertEq(decoded.amountIn, order.amountIn);
        assertEq(decoded.minAmountOut, order.minAmountOut);
        assertEq(decoded.targetChain, order.targetChain);
        assertEq(decoded.redeemer, order.redeemer);
        assertEq(decoded.sender, order.sender);
        assertEq(decoded.refundAddress, order.refundAddress);
        assertEq(decoded.slowSequence, order.slowSequence);
        assertEq(decoded.slowEmitter, order.slowEmitter);
        assertEq(decoded.maxFee, order.maxFee);
        assertEq(decoded.initAuctionFee, order.initAuctionFee);
        assertEq(decoded.redeemerMessage, order.redeemerMessage);
    }

    /**
     * SLOW TRANSFER TESTS
     */

    function testCannotPlaceMarketOrderErrInsufficientAmount() public {
        vm.expectRevert(abi.encodeWithSignature("ErrInsufficientAmount(uint256,uint128)", 0, 0));
        router.placeMarketOrder(
            0, // Zero amount - amountIn.
            0, // minAmountOut
            2, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this) // refundAddress
        );
    }

    function testCannotPlaceMarketOrderErrInvalidRefundAddress() public {
        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRefundAddress.selector));
        router.placeMarketOrder(
            10, // amountIn.
            0, // minAmountOut
            2, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(0) // Invalid address - refundAddress.
        );
    }

    function testCannotPlaceMarketOrderErrInvalidRedeemer() public {
        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRedeemerAddress.selector));
        router.placeMarketOrder(
            10, // amountIn.
            0, // minAmountOut
            2, // targetChain
            bytes32(0), // Invalid redeemer.
            bytes("All your base are belong to us."), // redeemerMessage
            address(this) // refundAddress
        );
    }

    function testCannotPlaceMarketOrderErrUnsupportedChain() public {
        uint256 amountIn = 69;
        uint16 targetChain = 2;

        vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedChain.selector, targetChain));
        router.placeMarketOrder(
            amountIn,
            amountIn,
            targetChain,
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this) // refundAddress
        );
    }

    function testPlaceMarketOrder(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, _cctpBurnLimit());

        _dealAndApproveUsdc(router, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: router.wormholeChainId(),
            orderSender: toUniversalAddress(address(this)),
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us")
        });

        bytes memory wormholeCctpPayload =
            _placeMarketOrder(router, amountIn, ARB_CHAIN, expectedFill);

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpPayload);

        // Check that the market order is encoded correctly.
        assertEq(deposit.payload, expectedFill.encode());

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(ARB_CHAIN),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(router)),
            mintRecipient: router.getRouter(ARB_CHAIN),
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testPlaceMarketOrderWithCctpInterface(uint256 amountIn) public {
        amountIn = bound(amountIn, 1, _cctpBurnLimit());

        _dealAndApproveUsdc(router, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: router.wormholeChainId(),
            orderSender: toUniversalAddress(address(this)),
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us")
        });

        bytes memory wormholeCctpPayload = _placeCctpMarketOrder(
            router, amountIn, ARB_CHAIN, TEST_REDEEMER, bytes("All your base are belong to us")
        );

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpPayload);

        // Check that the market order is encoded correctly.
        assertEq(deposit.payload, expectedFill.encode());

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(ARB_CHAIN),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(router)),
            mintRecipient: router.getRouter(ARB_CHAIN),
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testCannotPlaceFastMarketOrderErrInvalidRefundAddress() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMinTransferAmount(), // amountIn.
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(0), // Invalid address - refundAddress.
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(
            address(router),
            encodedSignature,
            abi.encodeWithSelector(ErrInvalidRefundAddress.selector)
        );
    }

    function testCannotPlaceFastMarketOrderErrInsufficientAmount() public {
        uint256 amountIn = router.getMinFee();
        uint128 maxFee = router.getMinFee();

        vm.expectRevert(
            abi.encodeWithSignature("ErrInsufficientAmount(uint256,uint128)", amountIn, maxFee)
        );
        router.placeFastMarketOrder(
            amountIn,
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress.
            maxFee,
            0 // deadline
        );
    }

    function testCannotPlaceFastMarketOrderErrInvalidMaxFee() public {
        uint128 maxFee = router.getMinFee() - 1;
        vm.expectRevert(
            abi.encodeWithSignature("ErrInvalidMaxFee(uint128,uint128)", maxFee, router.getMinFee())
        );
        router.placeFastMarketOrder(
            6900000, // amountIn.
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress.
            maxFee,
            0 // deadline
        );
    }

    function testCannotPlaceFastMarketOrderErrInvalidRedeemerAddress() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMinTransferAmount(), // amountIn.
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            bytes32(0), // Invalid address.
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // Invalid address - refundAddress.
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(
            address(router),
            encodedSignature,
            abi.encodeWithSelector(ErrInvalidRedeemerAddress.selector)
        );
    }

    function testCannotPlaceFastMarketOrderErrUnsupportedChain() public {
        uint16 unsupportedChain = 2;

        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMinTransferAmount(),
            0, // minAmountOut
            unsupportedChain, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(
            address(router),
            encodedSignature,
            abi.encodeWithSelector(ErrUnsupportedChain.selector, unsupportedChain)
        );
    }

    function testCannotPlaceFastMarketOrderErrFastTransferDisabled() public {
        vm.prank(makeAddr("owner"));
        router.enableFastTransfers(false);

        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMinTransferAmount(),
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(
            address(router),
            encodedSignature,
            abi.encodeWithSelector(ErrFastTransferDisabled.selector)
        );
    }

    function testCannotPlaceFastMarketOrderErrAmountTooLarge() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMaxTransferAmount() + 1,
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(
            address(router),
            encodedSignature,
            abi.encodeWithSelector(
                ErrAmountTooLarge.selector, FAST_TRANSFER_MAX_AMOUNT + 1, FAST_TRANSFER_MAX_AMOUNT
            )
        );
    }

    function testCannotPlaceFastMarketOrderContractPaused() public {
        vm.prank(makeAddr("owner"));
        router.setPause(true);

        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint256,uint256,uint16,bytes32,bytes,address,uint128,uint32)",
            router.getMinTransferAmount(),
            0, // minAmountOut
            ARB_CHAIN, // targetChain
            TEST_REDEEMER,
            bytes("All your base are belong to us."), // redeemerMessage
            address(this), // refundAddress
            router.getMinFee(),
            0 // deadline
        );
        expectRevert(address(router), encodedSignature, abi.encodeWithSignature("ContractPaused()"));
    }

    function testPlaceFastMarketOrder(uint256 amountIn, uint128 maxFee, uint32 deadline) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(WORMHOLE_CCTP_ADDRESS);

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            slowEmitter: toUniversalAddress(WORMHOLE_CCTP_ADDRESS),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder, maxFee);

        // Verify fast message payload.
        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(
            deposit.payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode()
        );

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(matchingEngineChain),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(router)),
            mintRecipient: matchingEngineAddress,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testPlaceFastMarketOrderWithCctpInterface(
        uint256 amountIn,
        uint128 maxFee,
        uint32 deadline
    ) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(WORMHOLE_CCTP_ADDRESS);

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: bytes32(0),
            slowSequence: slowSequence,
            slowEmitter: toUniversalAddress(WORMHOLE_CCTP_ADDRESS),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
        _placeCctpFastMarketOrder(
            router,
            expectedFastMarketOrder.amountIn,
            expectedFastMarketOrder.targetChain,
            expectedFastMarketOrder.redeemer,
            expectedFastMarketOrder.redeemerMessage,
            maxFee,
            expectedFastMarketOrder.deadline
        );

        // Verify fast message payload.
        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(
            deposit.payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode()
        );

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(matchingEngineChain),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(router)),
            mintRecipient: matchingEngineAddress,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    function testPlaceFastMarketOrderTargetIsMatchingEngine(
        uint256 amountIn,
        uint128 maxFee,
        uint32 deadline
    ) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(WORMHOLE_CCTP_ADDRESS);

        // Register a router for the matching engine chain.
        uint16 targetChain = matchingEngineChain;
        bytes32 targetRouter = toUniversalAddress(makeAddr("targetRouter"));

        vm.prank(makeAddr("owner"));
        router.addRouterEndpoint(targetChain, targetRouter);

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: targetChain,
            redeemer: TEST_REDEEMER,
            sender: toUniversalAddress(address(this)),
            refundAddress: toUniversalAddress(address(this)),
            slowSequence: slowSequence,
            slowEmitter: toUniversalAddress(WORMHOLE_CCTP_ADDRESS),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder, maxFee);

        // Verify fast message payload.
        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(
            deposit.payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode()
        );

        // And check that the transfer is encoded correctly.
        ICircleIntegration.DepositWithPayload memory expectedDeposit = ICircleIntegration
            .DepositWithPayload({
            token: toUniversalAddress(USDC_ADDRESS),
            amount: amountIn,
            sourceDomain: wormholeCctp.localDomain(),
            targetDomain: wormholeCctp.getDomainFromChainId(matchingEngineChain),
            nonce: deposit.nonce, // This nonce comes from Circle's bridge.
            fromAddress: toUniversalAddress(address(router)),
            mintRecipient: matchingEngineAddress,
            payload: deposit.payload
        });
        assertEq(keccak256(abi.encode(deposit)), keccak256(abi.encode(expectedDeposit)));
    }

    /**
     * FILL REDEMPTION TESTS
     */

    function testCannotRedeemFillInvalidSourceRouter() public {
        bytes32 invalidRouter = toUniversalAddress(makeAddr("notArbRouter"));

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: ARB_CHAIN,
            orderSender: TEST_REDEEMER,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            69, // amount
            invalidRouter,
            ARB_CHAIN,
            fill.encode()
        );

        vm.expectRevert(
            abi.encodeWithSelector(ErrInvalidSourceRouter.selector, invalidRouter, ARB_ROUTER)
        );
        router.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
    }

    function testCannotRedeemFillInvalidRedeemer() public {
        bytes32 invalidRedeemer = toUniversalAddress(makeAddr("notArbRedeemer"));

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: ARB_CHAIN,
            orderSender: TEST_REDEEMER,
            redeemer: toUniversalAddress(address(this)),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            69, // amount
            ARB_ROUTER,
            ARB_CHAIN,
            fill.encode()
        );

        vm.prank(fromUniversalAddress(invalidRedeemer));
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidRedeemer.selector, invalidRedeemer, toUniversalAddress(address(this))
            )
        );
        router.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
    }

    function testRedeemFill(uint256 amount) public {
        amount = bound(amount, 1, _cctpMintLimit());

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: TEST_REDEEMER,
            senderChain: ARB_CHAIN,
            token: address(router.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemWormholeCctpFill(router, expectedRedeemed, ARB_ROUTER, ARB_CHAIN);
    }

    /**
     * TEST HELPERS
     */

    function _dealAndApproveUsdc(ITokenRouter _router, uint256 amount) internal {
        mintUSDC(amount, address(this));
        IERC20(USDC_ADDRESS).approve(address(_router), amount);
    }

    function mintUSDC(uint256 amount, address receiver) public {
        IUSDC usdc = IUSDC(USDC_ADDRESS);
        require(amount <= type(uint256).max - usdc.totalSupply(), "total supply overflow");
        vm.prank(usdc.masterMinter());
        usdc.configureMinter(address(this), type(uint256).max);
        usdc.mint(receiver, amount);
    }

    function _cctpBurnLimit() internal returns (uint256 limit) {
        limit = wormholeCctp.circleBridge().localMinter().burnLimitsPerMessage(USDC_ADDRESS);

        // Having this check prevents us forking a network where Circle has not set a burn limit.
        assertGt(limit, 0);
    }

    function _placeMarketOrder(
        ITokenRouter _router,
        uint256 amountIn,
        uint16 targetChain,
        Messages.Fill memory expectedFill
    ) internal returns (bytes memory) {
        return _placeMarketOrder(
            _router,
            amountIn,
            amountIn,
            targetChain,
            expectedFill.redeemer,
            expectedFill.redeemerMessage,
            makeAddr("Where's my money?")
        );
    }

    function _placeMarketOrder(
        ITokenRouter _router,
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage,
        address refundAddress
    ) internal returns (bytes memory) {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeMarketOrder(
            amountIn, minAmountOut, targetChain, redeemer, redeemerMessage, refundAddress
        );

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        // Finally balance check.
        assertEq(_router.orderToken().balanceOf(address(this)) + amountIn, balanceBefore);

        return wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;
    }

    function _placeCctpMarketOrder(
        ITokenRouter _router,
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage
    ) internal returns (bytes memory) {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeMarketOrder(amountIn, targetChain, redeemer, redeemerMessage);

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        // Finally balance check.
        assertEq(_router.orderToken().balanceOf(address(this)) + amountIn, balanceBefore);

        return wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;
    }

    function _placeFastMarketOrder(
        ITokenRouter _router,
        Messages.FastMarketOrder memory expectedOrder,
        uint128 maxFee
    ) internal returns (bytes memory slowMessage, bytes memory fastMessage) {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeFastMarketOrder(
            expectedOrder.amountIn,
            expectedOrder.minAmountOut,
            expectedOrder.targetChain,
            expectedOrder.redeemer,
            expectedOrder.redeemerMessage,
            fromUniversalAddress(expectedOrder.refundAddress),
            maxFee,
            expectedOrder.deadline
        );

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        slowMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;

        fastMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[1]
        ).payload;

        // Finally balance check.
        assertEq(
            _router.orderToken().balanceOf(address(this)) + expectedOrder.amountIn, balanceBefore
        );
    }

    function _placeCctpFastMarketOrder(
        ITokenRouter _router,
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage,
        uint128 maxFee,
        uint32 deadline
    ) internal returns (bytes memory slowMessage, bytes memory fastMessage) {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeFastMarketOrder(
            amountIn, targetChain, redeemer, redeemerMessage, maxFee, deadline
        );

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        slowMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;

        fastMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[1]
        ).payload;

        // Finally balance check.
        assertEq(_router.orderToken().balanceOf(address(this)) + amountIn, balanceBefore);
    }

    function _createSignedVaa(uint16 emitterChainId, bytes32 emitterAddress, bytes memory payload)
        internal
        view
        returns (bytes memory)
    {
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

    function _craftWormholeCctpRedeemParams(
        ITokenRouter _router,
        uint256 amount,
        bytes32 fromAddress,
        uint16 fromChain,
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
            mintRecipient: toUniversalAddress(address(_router)),
            payload: encodedMessage
        });

        bytes memory encodedVaa = _createSignedVaa(
            fromChain, emitterAddress, wormholeCctp.encodeDepositWithPayload(deposit)
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

    function _redeemWormholeCctpFill(
        ITokenRouter _router,
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
            _router, expectedRedeemed.amount, fromAddress, fromChain, fill.encode()
        );

        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        RedeemedFill memory redeemed = _router.redeemFill(
            OrderResponse({
                encodedWormholeMessage: redeemParams.encodedWormholeMessage,
                circleBridgeMessage: redeemParams.circleBridgeMessage,
                circleAttestation: redeemParams.circleAttestation
            })
        );
        assertEq(keccak256(abi.encode(redeemed)), keccak256(abi.encode(expectedRedeemed)));
        assertEq(_router.orderToken().balanceOf(address(this)), balanceBefore + redeemed.amount);
    }

    function _cctpMintLimit() internal returns (uint256 limit) {
        // This is a hack, assuming the burn limit == mint limit.
        return _cctpBurnLimit();
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
