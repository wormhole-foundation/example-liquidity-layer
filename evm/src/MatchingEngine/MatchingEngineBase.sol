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
import {toUniversalAddress, fromUniversalAddress, getDecimals, denormalizeAmount} from "../shared/Utils.sol";
import {getPendingOwnerState, getOwnerState, getPausedState} from "../shared/Admin.sol";
import {getExecutionRouteState, Route, RegisteredOrderRouters, getOrderRoutersState, CurvePoolInfo, getCurvePoolState} from "./MatchingEngineStorage.sol";

abstract contract MatchingEngineBase is MatchingEngineAdmin {
    using Messages for *;

    // Immutable state.
    uint16 public immutable _chainId;
    IWormhole private immutable _wormhole;
    ITokenBridge private immutable _tokenBridge;
    ICircleIntegration private immutable _circleIntegration;

    // Consts.
    uint256 public constant RELAY_TIMEOUT = 1800; // seconds
    uint32 private constant NONCE = 0;

    // Errors.
    error InvalidRoute();
    error RouteNotAvailable();
    error RouteMismatch();
    error UnregisteredOrderRouter();
    error NotAllowedRelayer();
    error NotAttested();
    error InvalidCCTPIndex();
    error InvalidRelayerFee();
    error SwapFailed();

    struct InternalOrderParameters {
        uint16 fromChain;
        address token;
        uint256 amount;
        uint256 vaaTimestmp;
        bytes32 fromAddress;
    }

    constructor(address wormholeTokenBridge, address wormholeCCTPBridge) {
        if (wormholeTokenBridge == address(0) || wormholeCCTPBridge == address(0)) {
            revert InvalidAddress();
        }

        _tokenBridge = ITokenBridge(wormholeTokenBridge);
        _circleIntegration = ICircleIntegration(wormholeCCTPBridge);
        _chainId = _tokenBridge.chainId();
        _wormhole = _tokenBridge.wormhole();
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

        // Fetch the token address for the transfer.
        address token = _getLocalTokenAddress(transfer.tokenAddress, transfer.tokenChain);

        return
            _executeOrder(
                InternalOrderParameters({
                    fromChain: vaa.unsafeEmitterChainFromVaa(),
                    token: token,
                    amount: denormalizeAmount(transfer.amount, getDecimals(token)),
                    vaaTimestmp: vaa.unsafeTimestampFromVaa(),
                    fromAddress: transfer.fromAddress
                }),
                transfer.payload.decodeMarketOrder()
            );
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

        return
            _executeOrder(
                InternalOrderParameters({
                    fromChain: redeemParams.encodedWormholeMessage.unsafeEmitterChainFromVaa(),
                    token: fromUniversalAddress(deposit.token),
                    amount: deposit.amount,
                    vaaTimestmp: redeemParams.encodedWormholeMessage.unsafeTimestampFromVaa(),
                    fromAddress: deposit.fromAddress
                }),
                deposit.payload.decodeMarketOrder()
            );
    }

    function executeOrder(
        uint256 amount,
        Messages.MarketOrder calldata order
    ) external payable notPaused returns (uint64 sequence) {
        if (order.relayerFee != 0 || order.allowedRelayers.length != 0) {
            revert InvalidRelayerFee();
        }

        /**
         * The msg.sender should be the OrderRouter contract on this chain. This
         * is verified in the `_executeOrder` method to prevent adding redundant
         * checks.
         *
         * Also, the timestamp is irrelevant here, since we ensure the relayer fee
         * is set to zero.
         */
        return
            _executeOrder(
                InternalOrderParameters({
                    fromChain: _chainId,
                    token: getExecutionRouteState().routes[_chainId].target,
                    amount: amount,
                    vaaTimestmp: 0,
                    fromAddress: toUniversalAddress(msg.sender)
                }),
                order
            );
    }

    // ------------------------------------ Internal Functions -------------------------------------

    function _executeOrder(
        InternalOrderParameters memory params,
        Messages.MarketOrder memory order
    ) private returns (uint64 sequence) {
        bytes32 fromRouter = getOrderRoutersState().registered[params.fromChain];
        bytes32 toRouter = getOrderRoutersState().registered[order.targetChain];

        if (params.fromAddress != fromRouter || toRouter == bytes32(0)) {
            revert UnregisteredOrderRouter();
        }

        // Verify the to and from route.
        (Route memory fromRoute, Route memory toRoute) = _verifyExecutionRoute(
            params.fromChain,
            order.targetChain,
            params.token
        );

        // If the order originates from this chain, we need to transfer the
        // tokens from the msg.sender to this contract.
        if (params.fromChain == _chainId) {
            SafeERC20.safeTransferFrom(
                IERC20(params.token),
                msg.sender,
                address(this),
                params.amount
            );
        }

        // Pay the msg.sender if they're an allowed relayer and the market order
        // specifies a nonzero relayer fee.
        uint256 amountIn = _handleRelayerFee(
            params.token,
            params.vaaTimestmp,
            params.amount,
            order.relayerFee,
            order.allowedRelayers
        );

        // Execute curve swap. The `amountOut` will be zero if the
        // swap fails for any reason.
        uint256 amountOut = _handleSwap(fromRoute, toRoute, amountIn, order.minAmountOut);

        // If the swap failed, revert the order and refund the redeemer on
        // the origin chain. Otherwise, bridge (or CCTP) the swapped token to the
        // destination chain.
        if (amountOut == 0) {
            if (params.fromChain == _chainId) {
                revert SwapFailed();
            }

            sequence = _handleBridgeOut(
                params.token,
                amountIn, // Send full amount back.
                params.fromChain,
                fromRouter,
                Messages
                    .OrderRevert({
                        reason: Messages.RevertType.SwapFailed,
                        refundAddress: order.refundAddress
                    })
                    .encode(),
                fromRoute.cctp
            );
        } else {
            sequence = _handleBridgeOut(
                toRoute.target,
                amountOut,
                order.targetChain,
                toRouter,
                Messages
                    .Fill({
                        sourceChain: params.fromChain,
                        orderSender: order.sender,
                        redeemer: order.redeemer,
                        redeemerMessage: order.redeemerMessage
                    })
                    .encode(),
                toRoute.cctp
            );
        }
    }

    function _verifyExecutionRoute(
        uint16 fromChain,
        uint16 targetChain,
        address token
    ) private view returns (Route memory fromRoute, Route memory toRoute) {
        fromRoute = getExecutionRouteState().routes[fromChain];
        toRoute = getExecutionRouteState().routes[targetChain];

        // Verify the executing path.
        if (toRoute.target == address(0)) {
            revert InvalidRoute();
        }

        if (fromRoute.cctp && toRoute.cctp) {
            revert RouteNotAvailable();
        }

        if (fromRoute.target != token) {
            revert RouteMismatch();
        }
    }

    function _handleSwap(
        Route memory fromRoute,
        Route memory toRoute,
        uint256 amountIn,
        uint256 minAmountOut
    ) private returns (uint256) {
        CurvePoolInfo memory curve = getCurvePoolState();
        address swapPool = address(curve.pool);

        // Verify that any cctp enabled route is using the native token pool index.
        if (
            (fromRoute.cctp && fromRoute.poolIndex != curve.nativeTokenIndex) ||
            (toRoute.cctp && toRoute.poolIndex != curve.nativeTokenIndex)
        ) {
            revert InvalidCCTPIndex();
        }

        SafeERC20.safeIncreaseAllowance(IERC20(fromRoute.target), swapPool, amountIn);

        // Perform the swap.
        (bool success, bytes memory result) = swapPool.call(
            abi.encodeWithSelector(
                ICurvePool.exchange.selector,
                int128(fromRoute.poolIndex),
                int128(toRoute.poolIndex),
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

        /**
         * Check if the msg.sender is an allowed relayer.
         *
         * If the difference between the current block timestamp and the message
         * timestamp is greater than the relay timeout, then any relayer is
         * allowed to complete the transfer for the relayer fee.
         *
         * NOTE: There are potential time synchronization issues here, but the
         * the relayer timeout is set to 30 minutes, so this should not be an
         * issue in practice.
         */
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
    function chainId() external view returns (uint16) {
        return _chainId;
    }

    function wormhole() external view returns (IWormhole) {
        return _wormhole;
    }

    function tokenBridge() external view returns (ITokenBridge) {
        return _tokenBridge;
    }

    function circleIntegration() external view returns (ICircleIntegration) {
        return _circleIntegration;
    }

    function getExecutionRoute(uint16 chainId_) external view returns (Route memory) {
        return getExecutionRouteState().routes[chainId_];
    }

    function getOrderRouter(uint16 chainId_) external view returns (bytes32) {
        return getOrderRoutersState().registered[chainId_];
    }

    function getCurvePoolInfo() external pure returns (CurvePoolInfo memory) {
        return getCurvePoolState();
    }

    function getCCTPIndex() external view returns (int128) {
        return int128(getCurvePoolState().nativeTokenIndex);
    }

    function owner() external view returns (address) {
        return getOwnerState().owner;
    }

    function pendingOwner() external view returns (address) {
        return getPendingOwnerState().pendingOwner;
    }

    function isPaused() external view returns (bool) {
        return getPausedState().paused;
    }
}
