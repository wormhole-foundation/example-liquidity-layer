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
    IMockTokenRouter,
    MockTokenRouterImplementation
} from "./helpers/mock/MockTokenRouterImplementation.sol";

import "../../src/TokenRouter/assets/Errors.sol";
import {TokenRouterImplementation} from "../../src/TokenRouter/TokenRouterImplementation.sol";
import {TokenRouterSetup} from "../../src/TokenRouter/TokenRouterSetup.sol";

import {Messages} from "../../src/shared/Messages.sol";
import {fromUniversalAddress, toUniversalAddress} from "../../src/shared/Utils.sol";

import "../../src/interfaces/ITokenRouter.sol";
import {FastTransferParameters} from "../../src/interfaces/Types.sol";

contract TokenRouterTest is Test {
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
    uint24 immutable FAST_TRANSFER_FEE_IN_BPS = 25000; // 0.25%.
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
            _token,
            _wormholeCircle,
            matchingEngineChain,
            matchingEngineAddress
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
                feeInBps: FAST_TRANSFER_FEE_IN_BPS,
                maxAmount: FAST_TRANSFER_MAX_AMOUNT,
                baseFee: FAST_TRANSFER_BASE_FEE,
                initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
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
        MockTokenRouterImplementation newImplementation = new MockTokenRouterImplementation(
            USDC_ADDRESS,
            address(wormholeCctp),
            matchingEngineChain,
            matchingEngineAddress
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
            USDC_ADDRESS,
            address(wormholeCctp),
            matchingEngineChain,
            matchingEngineAddress
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
        FastTransferParameters memory newParams =
            FastTransferParameters({feeInBps: 69, maxAmount: 420, baseFee: 100, initAuctionFee: 10});

        // Fetch current parameters.
        FastTransferParameters memory currentParams = router.getFastTransferParameters();
        assertEq(currentParams.feeInBps, FAST_TRANSFER_FEE_IN_BPS);
        assertEq(currentParams.maxAmount, FAST_TRANSFER_MAX_AMOUNT);
        assertEq(currentParams.baseFee, FAST_TRANSFER_BASE_FEE);
        assertEq(currentParams.initAuctionFee, FAST_TRANSFER_INIT_AUCTION_FEE);

        // Update to the new params.
        vm.prank(makeAddr("owner"));
        router.updateFastTransferParameters(newParams);

        FastTransferParameters memory params = router.getFastTransferParameters();
        assertEq(params.feeInBps, newParams.feeInBps);
        assertEq(params.maxAmount, newParams.maxAmount);
        assertEq(params.baseFee, newParams.baseFee);
        assertEq(params.initAuctionFee, newParams.initAuctionFee);
    }

    function testCannotUpdateFastTransferParametersZeroFeeInBps() public {
        // Set `feeInBps` to zero.
        FastTransferParameters memory newParams =
            FastTransferParameters({feeInBps: 0, maxAmount: 420, baseFee: 100, initAuctionFee: 10});

        // Update to the new params.
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidFeeInBps()"));
        router.updateFastTransferParameters(newParams);
    }

    function testCannotUpdateFastTransferParametersFeeInBpsTooLarge() public {
        // Set `feeInBps` to one larger than the max (defined in `State.sol`).
        FastTransferParameters memory newParams = FastTransferParameters({
            feeInBps: 1000001,
            maxAmount: 420,
            baseFee: 100,
            initAuctionFee: 10
        });

        // Update to the new params.
        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidFeeInBps()"));
        router.updateFastTransferParameters(newParams);
    }

    function testCannotUpdateFastTransferParametersInvalidMaxAmount() public {
        // Set `feeInBps` to one larger than the max (defined in `State.sol`).
        FastTransferParameters memory newParams = FastTransferParameters({
            feeInBps: 69,
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
        FastTransferParameters memory newParams = FastTransferParameters({
            feeInBps: 1000,
            maxAmount: 100,
            baseFee: 50,
            initAuctionFee: 25
        });

        // Update to the new params.
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.updateFastTransferParameters(newParams);
    }

    function testDisableFastTransfers() public {
        // Fetch current parameters.
        FastTransferParameters memory currentParams = router.getFastTransferParameters();
        assertEq(currentParams.feeInBps, FAST_TRANSFER_FEE_IN_BPS);
        assertEq(currentParams.maxAmount, FAST_TRANSFER_MAX_AMOUNT);
        assertEq(currentParams.baseFee, FAST_TRANSFER_BASE_FEE);
        assertEq(currentParams.initAuctionFee, FAST_TRANSFER_INIT_AUCTION_FEE);

        vm.prank(makeAddr("owner"));
        router.disableFastTransfers();

        FastTransferParameters memory params = router.getFastTransferParameters();
        assertEq(params.feeInBps, 0);
    }

    function testCannotDisableFastTransfersOnlyOwnerOrAssistant() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.disableFastTransfers();
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
        uint128 maxFee,
        uint128 initAuctionFee,
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
            maxFee: maxFee,
            initAuctionFee: initAuctionFee,
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
        assertEq(decoded.maxFee, order.maxFee);
        assertEq(decoded.initAuctionFee, order.initAuctionFee);
        assertEq(decoded.redeemerMessage, order.redeemerMessage);
    }

    /**
     * SLOW TRANSFER TESTS
     */

    function testCannotPlaceMarketOrderErrInsufficientAmount() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 0, // Zero amount.
            minAmountOut: 0,
            targetChain: 2,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInsufficientAmount.selector));
        router.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrInvalidRefundAddress() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 10,
            minAmountOut: 0,
            targetChain: 2,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0) // Invalid address.
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRefundAddress.selector));
        router.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrInvalidRedeemer() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 10,
            minAmountOut: 0,
            targetChain: 2,
            redeemer: bytes32(0), // Invalid redeemer.
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRedeemerAddress.selector));
        router.placeMarketOrder(args);
    }

    function testCannotPlaceMarketOrderErrUnsupportedChain() public {
        uint256 amountIn = 69;

        uint16 targetChain = 2;
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: amountIn,
            targetChain: targetChain,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedChain.selector, targetChain));
        router.placeMarketOrder(args);
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
            router,
            PlaceCctpMarketOrderArgs({
                amountIn: amountIn,
                targetChain: ARB_CHAIN,
                redeemer: TEST_REDEEMER,
                redeemerMessage: bytes("All your base are belong to us")
            })
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

    /**
     * FAST TRANSFER TESTS
     */

    function testCalculateMaxTransferFee() public {
        // Test using the default parameters.
        {
            uint256 amountIn = 1000e6; // 1000 USDC.
            uint256 expectedFee = 2595e4;

            uint256 fee = router.calculateMaxTransferFee(amountIn);
            assertEq(fee, expectedFee);
        }

        // Increase the amountIn.
        {
            uint256 amountIn = 1000000e6; // 1000 USDC.
            uint256 expectedFee = 2500095e4;

            uint256 fee = router.calculateMaxTransferFee(amountIn);
            assertEq(fee, expectedFee);
        }

        // Increase the dynamic fee.
        {
            // Set the dynamic fee to 0.01%.
            vm.prank(makeAddr("owner"));
            router.updateFastTransferParameters(
                FastTransferParameters({
                    feeInBps: 690000,
                    maxAmount: FAST_TRANSFER_MAX_AMOUNT,
                    baseFee: FAST_TRANSFER_BASE_FEE,
                    initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
                })
            );

            uint256 amountIn = 1000e6; // 1000 USDC.
            uint256 expectedFee = 689620000;

            uint256 fee = router.calculateMaxTransferFee(amountIn);
            assertEq(fee, expectedFee);
        }

        {
            // Set the dynamic fee to 0.01%.
            vm.prank(makeAddr("owner"));
            router.updateFastTransferParameters(
                FastTransferParameters({
                    feeInBps: 100,
                    maxAmount: FAST_TRANSFER_MAX_AMOUNT,
                    baseFee: FAST_TRANSFER_BASE_FEE,
                    initAuctionFee: FAST_TRANSFER_INIT_AUCTION_FEE
                })
            );

            uint256 amountIn = 1000e6; // 1000 USDC.
            uint256 expectedFee = 1099800; // 2.5 USDC.

            uint256 fee = router.calculateMaxTransferFee(amountIn);
            assertEq(fee, expectedFee);
        }

        // That is illegal!
        {
            uint256 amountIn = 1; // 1e-6 USDC.

            vm.expectRevert(abi.encodeWithSelector(ErrInsufficientAmount.selector));
            router.calculateMaxTransferFee(amountIn);
        }
    }

    function testCannotPlaceFastMarketOrderErrInvalidRefundAddress() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 69,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(0) // Invalid address.
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRefundAddress.selector));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderErrInsufficientAmount() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 0, // Zero amount.
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInsufficientAmount.selector));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderErrInvalidRedeemerAddress() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 69,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: bytes32(0), // Invalid address.
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInvalidRedeemerAddress.selector));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderErrUnsupportedChain() public {
        uint16 unsupportedChain = 2;

        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 690000,
            minAmountOut: 0,
            targetChain: unsupportedChain,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrUnsupportedChain.selector, unsupportedChain));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderErrFastTransferFeeUnset() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: 690000,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.prank(makeAddr("owner"));
        router.disableFastTransfers();

        vm.expectRevert(abi.encodeWithSelector(ErrFastTransferFeeUnset.selector));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderErrAmountTooLarge() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: FAST_TRANSFER_MAX_AMOUNT + 1,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                ErrAmountTooLarge.selector, FAST_TRANSFER_MAX_AMOUNT + 1, FAST_TRANSFER_MAX_AMOUNT
            )
        );
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderTransferAmountTooSmall() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: router.getMinTransferAmount() - 1,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.expectRevert(abi.encodeWithSelector(ErrInsufficientAmount.selector));
        router.placeFastMarketOrder(args);
    }

    function testCannotPlaceFastMarketOrderContractPaused() public {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: router.getMinTransferAmount(),
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us."),
            refundAddress: address(this)
        });

        vm.prank(makeAddr("owner"));
        router.setPause(true);

        vm.expectRevert(abi.encodeWithSignature("ContractPaused()"));
        router.placeFastMarketOrder(args);
    }

    function testPlaceFastMarketOrder(uint256 amountIn) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());

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
            slowSequence: 0,
            maxFee: router.getBaseFee(),
            initAuctionFee: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder);

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(deposit.payload, expectedFastMarketOrder.encode());

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

        // Now verify the fast message.
        expectedFastMarketOrder.maxFee = router.calculateMaxTransferFee(amountIn);
        expectedFastMarketOrder.initAuctionFee = router.getInitialAuctionFee();
        expectedFastMarketOrder.slowSequence = slowSequence;

        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());
    }

    function testPlaceFastMarketOrderWithCctpInterface(uint256 amountIn) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());

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
            slowSequence: 0,
            maxFee: router.getBaseFee(),
            initAuctionFee: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
        _placeCctpFastMarketOrder(
            router,
            PlaceCctpMarketOrderArgs({
                amountIn: expectedFastMarketOrder.amountIn,
                targetChain: expectedFastMarketOrder.targetChain,
                redeemer: expectedFastMarketOrder.redeemer,
                redeemerMessage: expectedFastMarketOrder.redeemerMessage
            })
        );

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(deposit.payload, expectedFastMarketOrder.encode());

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

        // Now verify the fast message.
        expectedFastMarketOrder.maxFee = router.calculateMaxTransferFee(amountIn);
        expectedFastMarketOrder.initAuctionFee = router.getInitialAuctionFee();
        expectedFastMarketOrder.slowSequence = slowSequence;

        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());
    }

    function testPlaceFastMarketOrderTargetIsMatchingEngine(uint256 amountIn) public {
        amountIn = bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount());

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
            slowSequence: 0,
            maxFee: router.getBaseFee(),
            initAuctionFee: 0,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (bytes memory wormholeCctpMessage, bytes memory fastTransferMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder);

        ICircleIntegration.DepositWithPayload memory deposit =
            wormholeCctp.decodeDepositWithPayload(wormholeCctpMessage);

        // Check that the fast market order is encoded correclty.
        assertEq(deposit.payload, expectedFastMarketOrder.encode());

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

        // Now verify the fast message.
        expectedFastMarketOrder.maxFee = router.calculateMaxTransferFee(amountIn);
        expectedFastMarketOrder.initAuctionFee = router.getInitialAuctionFee();
        expectedFastMarketOrder.slowSequence = slowSequence;

        assertEq(fastTransferMessage, expectedFastMarketOrder.encode());
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

    function _dealAndApproveUsdc(ITokenRouter _router, uint256 amount) internal {
        deal(USDC_ADDRESS, address(this), amount);
        IERC20(USDC_ADDRESS).approve(address(_router), amount);
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
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: amountIn,
            minAmountOut: amountIn,
            targetChain: targetChain,
            redeemer: expectedFill.redeemer,
            redeemerMessage: expectedFill.redeemerMessage,
            refundAddress: makeAddr("Where's my money?")
        });

        return _placeMarketOrder(_router, args);
    }

    function _placeMarketOrder(ITokenRouter _router, PlaceMarketOrderArgs memory args)
        internal
        returns (bytes memory)
    {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeMarketOrder(args);

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        // Finally balance check.
        assertEq(_router.orderToken().balanceOf(address(this)) + args.amountIn, balanceBefore);

        return wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;
    }

    function _placeCctpMarketOrder(ITokenRouter _router, PlaceCctpMarketOrderArgs memory args)
        internal
        returns (bytes memory)
    {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeMarketOrder(args);

        // Fetch the logs for Wormhole message.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 0);

        // Finally balance check.
        assertEq(_router.orderToken().balanceOf(address(this)) + args.amountIn, balanceBefore);

        return wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        ).payload;
    }

    function _placeFastMarketOrder(
        ITokenRouter _router,
        Messages.FastMarketOrder memory expectedOrder
    ) internal returns (bytes memory slowMessage, bytes memory fastMessage) {
        PlaceMarketOrderArgs memory args = PlaceMarketOrderArgs({
            amountIn: expectedOrder.amountIn,
            minAmountOut: expectedOrder.minAmountOut,
            targetChain: expectedOrder.targetChain,
            redeemer: expectedOrder.redeemer,
            redeemerMessage: expectedOrder.redeemerMessage,
            refundAddress: fromUniversalAddress(expectedOrder.refundAddress)
        });

        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeFastMarketOrder(args);

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
        assertEq(_router.orderToken().balanceOf(address(this)) + args.amountIn, balanceBefore);
    }

    function _placeCctpFastMarketOrder(ITokenRouter _router, PlaceCctpMarketOrderArgs memory args)
        internal
        returns (bytes memory slowMessage, bytes memory fastMessage)
    {
        // Grab balance.
        uint256 balanceBefore = _router.orderToken().balanceOf(address(this));

        // Record logs for placeMarketOrder.
        vm.recordLogs();

        // Place the order.
        _router.placeFastMarketOrder(args);

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
        assertEq(_router.orderToken().balanceOf(address(this)) + args.amountIn, balanceBefore);
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
}
