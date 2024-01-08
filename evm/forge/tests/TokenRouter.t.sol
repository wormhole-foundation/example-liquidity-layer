// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/StdUtils.sol";
import "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CircleSimulator} from "cctp-solidity/CircleSimulator.sol";
import {IUSDC} from "cctp-solidity/IUSDC.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ITokenMessenger} from "cctp-solidity/ITokenMessenger.sol";
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
import {Utils} from "../../src/shared/Utils.sol";

import "../../src/interfaces/ITokenRouter.sol";
import {FastTransferParameters} from "../../src/interfaces/ITokenRouterTypes.sol";

import {WormholeCctpMessages} from "../../src/shared/WormholeCctpMessages.sol";

contract TokenRouterTest is Test {
    using BytesParsing for bytes;
    using WormholeCctpMessages for *;
    using Messages for *;
    using Utils for *;

    // Avalanche.
    uint16 constant AVAX_CHAIN = 6;
    uint32 constant AVAX_DOMAIN = 1;
    address immutable CIRCLE_BRIDGE = vm.envAddress("AVAX_CIRCLE_BRIDGE");
    address immutable MESSAGE_TRANSMITTER = vm.envAddress("AVAX_MESSAGE_TRANSMITTER");
    address constant USDC_ADDRESS = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    IWormhole immutable wormhole = IWormhole(vm.envAddress("AVAX_WORMHOLE"));

    // Arbitrum.
    address constant ARBITRUM_USDC_ADDRESS = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    uint32 constant ARB_DOMAIN = 3;
    uint16 constant ARB_CHAIN = 23;
    bytes32 immutable ARB_CIRCLE_BRIDGE = vm.envAddress("ARB_CIRCLE_BRIDGE").toUniversalAddress();
    bytes32 immutable ARB_ROUTER = makeAddr("arbRouter").toUniversalAddress();

    // Signer key.
    uint256 immutable TESTING_SIGNER = uint256(vm.envBytes32("TESTING_DEVNET_GUARDIAN"));

    // Fast transfer parameters.
    uint128 immutable FAST_TRANSFER_MAX_AMOUNT = 500000e6; // 500,000 USDC.
    uint128 immutable FAST_TRANSFER_BASE_FEE = 1e6; // 1 USDC.
    uint128 immutable FAST_TRANSFER_INIT_AUCTION_FEE = 1e6; // 1 USDC.

    // Matching engine (Ethereum).
    uint16 immutable matchingEngineChain = 2;
    bytes32 immutable matchingEngineAddress = makeAddr("ME").toUniversalAddress();
    uint32 immutable matchingEngineDomain = 0;

    // Test.
    bytes32 immutable TEST_REDEEMER = makeAddr("TEST_REDEEMER").toUniversalAddress();

    // State.
    ITokenRouter router;
    SigningWormholeSimulator wormholeSimulator;
    CircleSimulator circleSimulator;

    function deployProxy(address _token, address _wormhole, address _tokenMessenger)
        internal
        returns (ITokenRouter)
    {
        // Deploy Implementation.
        TokenRouterImplementation implementation = new TokenRouterImplementation(
            _token,
            _wormhole,
            _tokenMessenger,
            matchingEngineChain,
            matchingEngineAddress,
            matchingEngineDomain
        );

        // Deploy Setup.
        TokenRouterSetup setup = new TokenRouterSetup();

        address proxy = setup.deployProxy(address(implementation), makeAddr("ownerAssistant"));

        return ITokenRouter(proxy);
    }

    function setUp() public {
        // Set up token routers. These routers will represent the different outbound paths.
        vm.startPrank(makeAddr("owner"));
        router = deployProxy(USDC_ADDRESS, address(wormhole), CIRCLE_BRIDGE);

        // Set the allowance to the max.
        router.setCctpAllowance(type(uint256).max);

        // Register target chain endpoints.
        router.addRouterEndpoint(ARB_CHAIN, ARB_ROUTER, ARB_DOMAIN);

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

        wormholeSimulator = new SigningWormholeSimulator(wormhole, TESTING_SIGNER);

        circleSimulator = new CircleSimulator(TESTING_SIGNER, MESSAGE_TRANSMITTER);
        circleSimulator.setupCircleAttester();
    }

    /**
     * ADMIN TESTS
     */

    function testUpgradeContract() public {
        // Deploy new implementation.
        MockTokenRouterImplementation newImplementation = new MockTokenRouterImplementation(
            USDC_ADDRESS,
            address(wormhole),
            CIRCLE_BRIDGE,
            matchingEngineChain,
            matchingEngineAddress,
            matchingEngineDomain
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
            address(wormhole),
            CIRCLE_BRIDGE,
            matchingEngineChain,
            matchingEngineAddress,
            matchingEngineDomain
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
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        uint32 domain = 1;

        assertEq(router.getRouter(chain), bytes32(0));
        assertEq(router.getDomain(chain), 0);

        vm.prank(makeAddr("owner"));
        router.addRouterEndpoint(chain, routerEndpoint, domain);

        assertEq(router.getRouter(chain), routerEndpoint);
        assertEq(router.getDomain(chain), domain);
    }

    function testCannotAddRouterEndpointChainIdZero() public {
        uint16 chain = 0;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        uint32 domain = 1;

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        router.addRouterEndpoint(chain, routerEndpoint, domain);
    }

    function testCannotAddRouterEndpointThisChain() public {
        uint16 chain = router.wormholeChainId();
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        uint32 domain = 1;

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrChainNotAllowed(uint16)", chain));
        router.addRouterEndpoint(chain, routerEndpoint, domain);
    }

    function testCannotAddRouterEndpointInvalidEndpoint() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = bytes32(0);
        uint32 domain = 1;

        vm.prank(makeAddr("owner"));
        vm.expectRevert(abi.encodeWithSignature("ErrInvalidEndpoint(bytes32)", routerEndpoint));
        router.addRouterEndpoint(chain, routerEndpoint, domain);
    }

    function testCannotAddRouterEndpointOwnerOrAssistantOnly() public {
        uint16 chain = 1;
        bytes32 routerEndpoint = makeAddr("newRouter").toUniversalAddress();
        uint32 domain = 1;

        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.addRouterEndpoint(chain, routerEndpoint, domain);
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

    function testSetCctpAllowance() public {
        uint256 allowance = 100;

        assertEq(IERC20(USDC_ADDRESS).allowance(address(router), CIRCLE_BRIDGE), type(uint256).max);

        vm.prank(makeAddr("owner"));
        router.setCctpAllowance(allowance);

        assertEq(IERC20(USDC_ADDRESS).allowance(address(router), CIRCLE_BRIDGE), allowance);
    }

    function testCannotSetCctpAllowanceOnlyOwnerOrAssistant() public {
        vm.prank(makeAddr("robber"));
        vm.expectRevert(abi.encodeWithSignature("NotTheOwnerOrAssistant()"));
        router.setCctpAllowance(0);
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
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        uint32 targetDomain,
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
            targetDomain: targetDomain,
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
        assertEq(decoded.targetDomain, order.targetDomain);
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
        vm.expectRevert(abi.encodeWithSignature("ErrInsufficientAmount(uint128,uint128)", 0, 0));
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
        uint128 amountIn = 69;
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

    function testPlaceMarketOrder(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1, _cctpBurnLimit()));

        _dealAndApproveUsdc(router, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: router.wormholeChainId(),
            orderSender: address(this).toUniversalAddress(),
            redeemer: TEST_REDEEMER,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the order and parse the deposit message.
        (
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 targetCctpDomain,
            ,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        ) = _placeMarketOrder(router, amountIn, ARB_CHAIN, expectedFill).decodeDeposit();

        // Compare the expected values with the actual deposit message.
        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, amountIn);
        assertEq(sourceCctpDomain, AVAX_DOMAIN);
        assertEq(targetCctpDomain, ARB_DOMAIN);
        assertEq(burnSource, address(this).toUniversalAddress());
        assertEq(mintRecipient, ARB_ROUTER);
        assertEq(payload, expectedFill.encode());
    }

    function testPlaceMarketOrderWithCctpInterface(uint128 amountIn) public {
        amountIn = uint128(bound(amountIn, 1, _cctpBurnLimit()));
        bytes memory message = bytes("All your base are belong to us");

        _dealAndApproveUsdc(router, amountIn);

        Messages.Fill memory expectedFill = Messages.Fill({
            sourceChain: router.wormholeChainId(),
            orderSender: address(this).toUniversalAddress(),
            redeemer: TEST_REDEEMER,
            redeemerMessage: message
        });

        // Place the order and parse the deposit message.
        (
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 targetCctpDomain,
            ,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        ) = _placeCctpMarketOrder(router, amountIn, ARB_CHAIN, TEST_REDEEMER, message).decodeDeposit(
        );

        // Compare the expected values with the actual deposit message.
        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, amountIn);
        assertEq(sourceCctpDomain, AVAX_DOMAIN);
        assertEq(targetCctpDomain, ARB_DOMAIN);
        assertEq(burnSource, address(this).toUniversalAddress());
        assertEq(mintRecipient, ARB_ROUTER);
        assertEq(payload, expectedFill.encode());
    }

    function testCannotPlaceFastMarketOrderErrInvalidRefundAddress() public {
        bytes memory encodedSignature = abi.encodeWithSignature(
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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
        uint128 amountIn = router.getMinFee();
        uint128 maxFee = router.getMinFee();

        vm.expectRevert(
            abi.encodeWithSignature("ErrInsufficientAmount(uint128,uint128)", amountIn, maxFee)
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
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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
            "placeFastMarketOrder(uint128,uint128,uint16,bytes32,bytes,address,uint128,uint32)",
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

    function testPlaceFastMarketOrder(uint128 amountIn, uint128 maxFee, uint32 deadline) public {
        amountIn = uint128(
            bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount())
        );
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(address(router));

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            targetDomain: ARB_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            slowSequence: slowSequence,
            slowEmitter: address(router).toUniversalAddress(),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (IWormhole.VM memory cctpMessage, IWormhole.VM memory fastMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder, maxFee);

        // Validate the fast message payload.
        assertEq(fastMessage.payload, expectedFastMarketOrder.encode());

        // Validate the slow message.
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

        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, amountIn);
        assertEq(sourceCctpDomain, AVAX_DOMAIN);
        assertEq(targetCctpDomain, matchingEngineDomain);
        assertEq(burnSource, address(this).toUniversalAddress());
        assertEq(mintRecipient, matchingEngineAddress);
        assertEq(payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode());
    }

    function testPlaceFastMarketOrderWithCctpInterface(
        uint128 amountIn,
        uint128 maxFee,
        uint32 deadline
    ) public {
        amountIn = uint128(
            bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount())
        );
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(address(router));

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: ARB_CHAIN,
            targetDomain: ARB_DOMAIN,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(0).toUniversalAddress(),
            slowSequence: slowSequence,
            slowEmitter: address(router).toUniversalAddress(),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (IWormhole.VM memory cctpMessage, IWormhole.VM memory fastMessage) =
        _placeCctpFastMarketOrder(
            router,
            expectedFastMarketOrder.amountIn,
            expectedFastMarketOrder.targetChain,
            expectedFastMarketOrder.redeemer,
            expectedFastMarketOrder.redeemerMessage,
            maxFee,
            expectedFastMarketOrder.deadline
        );

        // Validate the fast message payload.
        assertEq(fastMessage.payload, expectedFastMarketOrder.encode());

        // Validate the slow message.
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

        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, amountIn);
        assertEq(sourceCctpDomain, AVAX_DOMAIN);
        assertEq(targetCctpDomain, matchingEngineDomain);
        assertEq(burnSource, address(this).toUniversalAddress());
        assertEq(mintRecipient, matchingEngineAddress);
        assertEq(payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode());
    }

    function testPlaceFastMarketOrderTargetIsMatchingEngine(
        uint128 amountIn,
        uint128 maxFee,
        uint32 deadline
    ) public {
        amountIn = uint128(
            bound(amountIn, router.getMinTransferAmount() + 1, router.getMaxTransferAmount())
        );
        maxFee = uint128(bound(maxFee, router.getMinFee(), amountIn - 1));

        _dealAndApproveUsdc(router, amountIn);

        // Register a router for the matching engine chain.
        uint16 targetChain = matchingEngineChain;
        bytes32 targetRouter = makeAddr("targetRouter").toUniversalAddress();

        vm.prank(makeAddr("owner"));
        router.addRouterEndpoint(targetChain, targetRouter, matchingEngineDomain);

        // The slow message is sent first.
        uint64 slowSequence = wormholeSimulator.nextSequence(address(router));

        // Create a fast market order, this is actually the payload that will be encoded
        // in the "slow message".
        Messages.FastMarketOrder memory expectedFastMarketOrder = Messages.FastMarketOrder({
            amountIn: amountIn,
            minAmountOut: 0,
            targetChain: matchingEngineChain,
            targetDomain: matchingEngineDomain,
            redeemer: TEST_REDEEMER,
            sender: address(this).toUniversalAddress(),
            refundAddress: address(this).toUniversalAddress(),
            slowSequence: slowSequence,
            slowEmitter: address(router).toUniversalAddress(),
            maxFee: maxFee - router.getInitialAuctionFee(),
            initAuctionFee: router.getInitialAuctionFee(),
            deadline: deadline,
            redeemerMessage: bytes("All your base are belong to us")
        });

        // Place the fast market order and store the two VAA payloads that were emitted.
        (IWormhole.VM memory cctpMessage, IWormhole.VM memory fastMessage) =
            _placeFastMarketOrder(router, expectedFastMarketOrder, maxFee);

        // Validate the fast message payload.
        assertEq(fastMessage.payload, expectedFastMarketOrder.encode());

        // Validate the slow message.
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

        assertEq(token, USDC_ADDRESS.toUniversalAddress());
        assertEq(amount, amountIn);
        assertEq(sourceCctpDomain, AVAX_DOMAIN);
        assertEq(targetCctpDomain, matchingEngineDomain);
        assertEq(burnSource, address(this).toUniversalAddress());
        assertEq(mintRecipient, matchingEngineAddress);
        assertEq(payload, Messages.SlowOrderResponse({baseFee: router.getBaseFee()}).encode());
    }

    /**
     * FILL REDEMPTION TESTS
     */

    function testCannotRedeemFillInvalidSourceRouter() public {
        bytes32 invalidRouter = makeAddr("notArbRouter").toUniversalAddress();

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: ARB_CHAIN,
            orderSender: TEST_REDEEMER,
            redeemer: address(this).toUniversalAddress(),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            69, // amount
            invalidRouter,
            ARB_CHAIN,
            ARB_DOMAIN,
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
        bytes32 invalidRedeemer = makeAddr("notArbRedeemer").toUniversalAddress();

        Messages.Fill memory fill = Messages.Fill({
            sourceChain: ARB_CHAIN,
            orderSender: TEST_REDEEMER,
            redeemer: address(this).toUniversalAddress(),
            redeemerMessage: bytes("Somebody set up us the bomb")
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            router,
            69, // amount
            ARB_ROUTER,
            ARB_CHAIN,
            ARB_DOMAIN,
            fill.encode()
        );

        vm.prank(invalidRedeemer.fromUniversalAddress());
        vm.expectRevert(
            abi.encodeWithSelector(
                ErrInvalidRedeemer.selector, invalidRedeemer, address(this).toUniversalAddress()
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

    function testRedeemFill(uint128 amount) public {
        amount = uint128(bound(amount, 1, _cctpMintLimit()));

        RedeemedFill memory expectedRedeemed = RedeemedFill({
            sender: TEST_REDEEMER,
            senderChain: ARB_CHAIN,
            token: address(router.orderToken()),
            amount: amount,
            message: bytes("Somebody set up us the bomb")
        });

        _redeemWormholeCctpFill(router, expectedRedeemed, ARB_ROUTER, ARB_CHAIN, ARB_DOMAIN);
    }

    /**
     * TEST HELPERS
     */

    function _dealAndApproveUsdc(ITokenRouter _router, uint128 amount) internal {
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
        limit = ITokenMessenger(CIRCLE_BRIDGE).localMinter().burnLimitsPerMessage(USDC_ADDRESS);

        // Having this check prevents us forking a network where Circle has not set a burn limit.
        assertGt(limit, 0);
    }

    function _placeMarketOrder(
        ITokenRouter _router,
        uint128 amountIn,
        uint16 targetChain,
        Messages.Fill memory expectedFill
    ) internal returns (IWormhole.VM memory) {
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
        uint128 amountIn,
        uint128 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage,
        address refundAddress
    ) internal returns (IWormhole.VM memory) {
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
        );
    }

    function _placeCctpMarketOrder(
        ITokenRouter _router,
        uint128 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage
    ) internal returns (IWormhole.VM memory) {
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
        );
    }

    function _placeFastMarketOrder(
        ITokenRouter _router,
        Messages.FastMarketOrder memory expectedOrder,
        uint128 maxFee
    ) internal returns (IWormhole.VM memory slowMessage, IWormhole.VM memory fastMessage) {
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
            expectedOrder.refundAddress.fromUniversalAddress(),
            maxFee,
            expectedOrder.deadline
        );

        // Fetch the logs for Wormhole message. There should be two messages.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertGt(logs.length, 1);

        slowMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[0]
        );

        fastMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[1]
        );

        // Finally balance check.
        assertEq(
            _router.orderToken().balanceOf(address(this)) + expectedOrder.amountIn, balanceBefore
        );
    }

    function _placeCctpFastMarketOrder(
        ITokenRouter _router,
        uint128 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes memory redeemerMessage,
        uint128 maxFee,
        uint32 deadline
    ) internal returns (IWormhole.VM memory slowMessage, IWormhole.VM memory fastMessage) {
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
        );

        fastMessage = wormholeSimulator.parseVMFromLogs(
            wormholeSimulator.fetchWormholeMessageFromLog(logs)[1]
        );

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
        bytes32 emitterAddress,
        uint16 fromChain,
        uint32 fromDomain,
        bytes memory encodedMessage
    ) internal view returns (ICircleIntegration.RedeemParameters memory) {
        bytes memory encodedDeposit = WormholeCctpMessages.encodeDeposit(
            ARBITRUM_USDC_ADDRESS,
            amount,
            fromDomain,
            AVAX_DOMAIN,
            2 ** 64 - 1, // Nonce.
            emitterAddress,
            address(_router).toUniversalAddress(),
            encodedMessage
        );

        bytes memory circleMessage = circleSimulator.encodeBurnMessageLog(
            CircleSimulator.CircleMessage({
                version: 0,
                sourceDomain: fromDomain,
                targetDomain: AVAX_DOMAIN,
                nonce: 2 ** 64 - 1,
                sourceCircle: ARB_CIRCLE_BRIDGE,
                targetCircle: CIRCLE_BRIDGE.toUniversalAddress(),
                targetCaller: address(router).toUniversalAddress(),
                token: ARBITRUM_USDC_ADDRESS.toUniversalAddress(),
                mintRecipient: address(router).toUniversalAddress(),
                amount: amount,
                transferInitiator: ARB_ROUTER
            })
        );

        return ICircleIntegration.RedeemParameters({
            encodedWormholeMessage: _createSignedVaa(fromChain, emitterAddress, encodedDeposit),
            circleBridgeMessage: circleMessage,
            circleAttestation: circleSimulator.attestCircleMessage(circleMessage)
        });
    }

    function _redeemWormholeCctpFill(
        ITokenRouter _router,
        RedeemedFill memory expectedRedeemed,
        bytes32 fromAddress,
        uint16 fromChain,
        uint32 fromDomain
    ) internal {
        Messages.Fill memory fill = Messages.Fill({
            sourceChain: expectedRedeemed.senderChain,
            orderSender: expectedRedeemed.sender,
            redeemer: address(this).toUniversalAddress(),
            redeemerMessage: expectedRedeemed.message
        });

        ICircleIntegration.RedeemParameters memory redeemParams = _craftWormholeCctpRedeemParams(
            _router, expectedRedeemed.amount, fromAddress, fromChain, fromDomain, fill.encode()
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
