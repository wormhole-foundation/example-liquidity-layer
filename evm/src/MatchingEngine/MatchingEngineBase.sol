// SPDX-License-Identifier: Apache 2

pragma solidity 0.8.19;

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenBridge} from "wormhole-solidity/ITokenBridge.sol";
import {ICircleIntegration} from "wormhole-solidity/ICircleIntegration.sol";
import {ICurvePool} from "curve-solidity/ICurvePool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Messages} from "../shared/Messages.sol";
import {MatchingEngineAdmin} from "./MatchingEngineAdmin.sol";
import {toUniversalAddress, fromUniversalAddress, getDecimals, normalizeAmount, denormalizeAmount} from "../shared/Utils.sol";
import {getPendingOwnerState, getOwnerState, getPausedState} from "../shared/Admin.sol";
import {getExecutionRouteState, Route, RegisteredOrderRouters, getOrderRoutersState, CurvePoolInfo, getCurvePoolState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineBase is MatchingEngineAdmin {
    using Messages for *;

    // Immutable state.
    uint16 private immutable _chainId;
    IWormhole private immutable _wormhole;
    ITokenBridge private immutable _tokenBridge;
    ICircleIntegration private immutable _circleIntegration;

    // Consts.
    uint256 public constant RELAY_TIMEOUT = 900; // seconds
    uint32 private constant NONCE = 0;

    // Errors.
    error InvalidRoute();
    error RouteNotAvailable();
    error RouteMismatch();
    error UnregisteredOrderRouter();
    error NotAllowedRelayer();
    error NotAttested();

    constructor(
        address tokenBridge,
        address circleIntegration,
        address curve,
        int8 nativeTokenPoolIndex
    ) {
        if (tokenBridge == address(0) || circleIntegration == address(0) || curve == address(0)) {
            revert InvalidAddress();
        }

        _tokenBridge = ITokenBridge(tokenBridge);
        _circleIntegration = ICircleIntegration(circleIntegration);
        _chainId = _tokenBridge.chainId();
        _wormhole = _tokenBridge.wormhole();

        // Set curve pool info in storage.
        CurvePoolInfo storage info = getCurvePoolState();
        info.pool = ICurvePool(curve);
        info.nativeTokenIndex = nativeTokenPoolIndex;
    }

    function executeOrder(bytes calldata vaa) external payable notPaused returns (uint64 sequence) {
        /**
         * Call `completeTransferWithPayload` on the token bridge. This
         * method acts as a reentrancy protection since it does not allow
         * transfers to be redeemed more than once. Also, parse the
         * the transfer payload.
         */
        ITokenBridge.TransferWithPayload memory transfer = _tokenBridge.parseTransferWithPayload(
            _tokenBridge.completeTransferWithPayload(vaa)
        );

        // Parse the market order.
        Messages.MarketOrder memory order = transfer.payload.decodeMarketOrder();

        // SECURITY: Verify the to/from order routers.
        uint16 fromChain = vaa.unsafeEmitterChainFromVaa();
        RegisteredOrderRouters storage routers = _verifyMessageRoute(
            fromChain,
            transfer.fromAddress,
            order.targetChain
        );

        // Fetch the token bridge representation of the bridged token.
        address token = _getLocalTokenAddress(transfer.tokenAddress, transfer.tokenChain);

        // Determine if the `toRoute` is enabled and the `fromRoute`
        // is configured correctly.
        Route memory toRoute = _fetchAndVerifyRoute(order.targetChain);
        Route memory fromRoute = getExecutionRouteState().routes[fromChain];
        if (fromRoute.target != token) {
            revert RouteMismatch();
        }

        // Pay the msg.sender if they're an allowed relayer and the market order
        // specifies a nonzero relayer fee.
        uint256 amountIn = _handleRelayerFee(
            token,
            vaa.unsafeTimestampFromVaa(),
            denormalizeAmount(transfer.amount, getDecimals(token)),
            order.relayerFee,
            order.allowedRelayers
        );

        // Execute curve swap. The `amountOut` will be zero if the swap fails
        // for any reason. If the `toRoute` is a CCTP chain, then the `toIndex`
        // will be the native token index.
        CurvePoolInfo memory curve = getCurvePoolState();
        uint256 amountOut = _handleSwap(
            token,
            address(curve.pool),
            int128(fromRoute.poolIndex),
            toRoute.cctp ? int128(curve.nativeTokenIndex) : int128(toRoute.poolIndex),
            amountIn,
            order.minAmountOut
        );

        // If the swap failed, revert the order and refund the redeemer on
        // the origin chain. Otherwise, bridge (or CCTP) the swapped token to the
        // destination chain.
        if (amountOut == 0) {
            sequence = _handleBridgeOut(
                token,
                amountIn, // Send full amount back.
                fromChain,
                routers.registered[fromChain],
                Messages
                    .OrderRevert({
                        reason: Messages.RevertType.SwapFailed,
                        refundAddress: order.refundAddress
                    })
                    .encode(),
                false // Not CCTP
            );
        } else {
            _handleBridgeOut(
                toRoute.target,
                amountOut,
                order.targetChain,
                routers.registered[order.targetChain],
                Messages
                    .Fill({
                        sourceChain: fromChain,
                        orderSender: order.sender,
                        redeemer: order.redeemer,
                        redeemerMessage: order.redeemerMessage
                    })
                    .encode(),
                toRoute.cctp
            );
        }
    }

    function executeOrder(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external payable notPaused returns (uint64 sequence) {
        /**
         * Mint tokens to this contract. Serves as a reentrancy protection,
         * since the circle integration contract will not allow the wormhole
         * message in the redeemParams to be replayed.
         */
        ICircleIntegration.DepositWithPayload memory deposit = _circleIntegration
            .redeemTokensWithPayload(redeemParams);

        // Parse the market order.
        Messages.MarketOrder memory order = deposit.payload.decodeMarketOrder();

        // SECURITY: Verify the to/from order routers.
        uint16 fromChain = _circleIntegration.getChainIdFromDomain(deposit.sourceDomain);
        RegisteredOrderRouters storage routers = _verifyMessageRoute(
            fromChain,
            deposit.fromAddress,
            order.targetChain
        );

        // Determine if the target route is enabled. This contract should
        // not receive a circle integration message if the target route is
        // a CCTP chain.
        Route memory route = _fetchAndVerifyRoute(order.targetChain);
        if (route.cctp) {
            revert RouteNotAvailable();
        }

        // Pay the msg.sender if they're an allowed relayer and the market order
        // specifies a nonzero relayer fee.
        address token = fromUniversalAddress(deposit.token);
        uint256 amountIn = _handleRelayerFee(
            token,
            redeemParams.encodedWormholeMessage.unsafeTimestampFromVaa(),
            deposit.amount,
            order.relayerFee,
            order.allowedRelayers
        );

        // Execute curve swap. The `amountOut` will be zero if the
        // swap fails for any reason.
        CurvePoolInfo memory curve = getCurvePoolState();
        uint256 amountOut = _handleSwap(
            token,
            address(curve.pool),
            int128(curve.nativeTokenIndex),
            int128(route.poolIndex),
            amountIn,
            order.minAmountOut
        );

        // If the swap failed, revert the order and refund the redeemer on
        // the origin chain. Otherwise, bridge the swapped token to the
        // destination chain.
        if (amountOut == 0) {
            sequence = _handleBridgeOut(
                token,
                amountIn, // Send full amount back.
                fromChain,
                routers.registered[fromChain],
                Messages
                    .OrderRevert({
                        reason: Messages.RevertType.SwapFailed,
                        refundAddress: order.refundAddress
                    })
                    .encode(),
                true // CCTP
            );
        } else {
            sequence = _handleBridgeOut(
                route.target,
                amountOut,
                order.targetChain,
                routers.registered[order.targetChain],
                Messages
                    .Fill({
                        sourceChain: fromChain,
                        orderSender: order.sender,
                        redeemer: order.redeemer,
                        redeemerMessage: order.redeemerMessage
                    })
                    .encode(),
                false // Not CCTP
            );
        }
    }

    // ------------------------------------ Internal Functions -------------------------------------

    function _fetchAndVerifyRoute(uint16 chainId) private view returns (Route memory route) {
        route = getExecutionRouteState().routes[chainId];
        if (route.target == address(0)) {
            revert InvalidRoute();
        }
    }

    function _verifyMessageRoute(
        uint16 fromChain,
        bytes32 fromAddress,
        uint16 targetChain
    ) private view returns (RegisteredOrderRouters storage routers) {
        routers = getOrderRoutersState();
        if (
            fromAddress != routers.registered[fromChain] ||
            routers.registered[targetChain] == bytes32(0)
        ) {
            revert UnregisteredOrderRouter();
        }
    }

    function _handleSwap(
        address token,
        address swapPool,
        int128 fromIndex,
        int128 toIndex,
        uint256 amountIn,
        uint256 minAmountOut
    ) private returns (uint256) {
        SafeERC20.safeIncreaseAllowance(IERC20(token), swapPool, amountIn);

        // Perform the swap.
        (bool success, bytes memory result) = swapPool.call(
            abi.encodeWithSelector(
                ICurvePool.exchange.selector,
                fromIndex,
                toIndex,
                amountIn,
                minAmountOut
            )
        );

        if (success) {
            return abi.decode(result, (uint256));
        } else {
            return 0;
        }
    }

    function _handleRelayerFee(
        address token,
        uint256 messageTime,
        uint256 amountIn,
        uint256 relayerFee,
        bytes32[] memory allowedRelayers
    ) private returns (uint256) {
        if (relayerFee == 0) {
            return amountIn;
        }

        uint256 relayerCount = allowedRelayers.length;
        bytes32 relayer = toUniversalAddress(msg.sender);

        // Check if the msg.sender is an allowed relayer.
        bool allowed = false;
        if (relayerCount == 0 || block.timestamp > messageTime + RELAY_TIMEOUT) {
            allowed = true;
        } else {
            for (uint256 i = 0; i < relayerCount; ) {
                if (relayer == allowedRelayers[i]) {
                    allowed = true;
                    break;
                }

                unchecked {
                    ++i;
                }
            }
        }

        if (!allowed) {
            revert NotAllowedRelayer();
        }

        SafeERC20.safeTransfer(IERC20(token), msg.sender, relayerFee);

        return amountIn - relayerFee;
    }

    function _handleBridgeOut(
        address token,
        uint256 amount,
        uint16 recipientChain,
        bytes32 recipient,
        bytes memory payload,
        bool isCCTP
    ) private returns (uint64 sequence) {
        SafeERC20.safeIncreaseAllowance(
            IERC20(token),
            isCCTP ? address(_circleIntegration) : address(_tokenBridge),
            amount
        );

        if (isCCTP) {
            sequence = _circleIntegration.transferTokensWithPayload{value: msg.value}(
                ICircleIntegration.TransferParameters({
                    token: token,
                    amount: amount,
                    targetChain: recipientChain,
                    mintRecipient: recipient
                }),
                NONCE,
                payload
            );
        } else {
            sequence = _tokenBridge.transferTokensWithPayload{value: msg.value}(
                token,
                amount,
                recipientChain,
                recipient,
                NONCE,
                payload
            );
        }
    }

    function _getLocalTokenAddress(
        bytes32 tokenAddress,
        uint16 tokenChain
    ) private view returns (address localAddress) {
        // Fetch the wrapped address from the token bridge if the token
        // is not from this chain.
        if (tokenChain != _chainId) {
            // identify wormhole token bridge wrapper
            localAddress = _tokenBridge.wrappedAsset(tokenChain, tokenAddress);
            if (localAddress == address(0)) {
                revert NotAttested();
            }
        } else {
            // return the encoded address if the token is native to this chain
            localAddress = fromUniversalAddress(tokenAddress);
        }
    }

    // ------------------------------------ Getter Functions --------------------------------------
    function getChainId() external view returns (uint16) {
        return _chainId;
    }

    function getWormhole() external view returns (IWormhole) {
        return _wormhole;
    }

    function getTokenBridge() external view returns (ITokenBridge) {
        return _tokenBridge;
    }

    function getCircleIntegration() external view returns (ICircleIntegration) {
        return _circleIntegration;
    }

    function getExecutionRoute(uint16 chainId) external view returns (Route memory) {
        return getExecutionRouteState().routes[chainId];
    }

    function getOrderRouter(uint16 chainId) external view returns (bytes32) {
        return getOrderRoutersState().registered[chainId];
    }

    function getCurvePoolInfo() external pure returns (CurvePoolInfo memory) {
        return getCurvePoolState();
    }

    function getCCTPIndex() external view returns (int128) {
        return int128(getCurvePoolState().nativeTokenIndex);
    }

    function getOwner() external view returns (address) {
        return getOwnerState().owner;
    }

    function getPendingOwner() external view returns (address) {
        return getPendingOwnerState().pendingOwner;
    }

    function getPaused() external view returns (bool) {
        return getPausedState().paused;
    }
}
