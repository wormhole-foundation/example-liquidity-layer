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
import {MatchingEngineState} from "./MatchingEngineState.sol";
import {toUniversalAddress, fromUniversalAddress, getDecimals, denormalizeAmount, adjustDecimalDiff} from "../shared/Utils.sol";
import {getPendingOwnerState, getOwnerState, getOwnerAssistantState, getPausedState} from "../shared/Admin.sol";
import {getExecutionRouteState, Route, CurvePoolInfo, getCurvePoolState, getDefaultRelayersState} from "./MatchingEngineStorage.sol";
import {RevertType} from "../interfaces/Types.sol";

abstract contract MatchingEngineBase is MatchingEngineAdmin {
    using Messages for *;

    // Errors.
    error InvalidRoute();
    error RouteNotAvailable();
    error RouteMismatch();
    error UnregisteredOrderRouter();
    error NotAllowedRelayer();
    error NotAttested();
    error InvalidRelayerFee();
    error SwapFailed();

    // Order executed event. This is used to help off-chain services determine the
    // sequence number of the fill or order revert.
    event OrderExecuted(
        uint16 indexed emitterChainId,
        bytes32 indexed emitterAddress,
        uint64 indexed sequence,
        uint64 newSequence,
        bool orderFilled
    );

    struct InternalOrderParameters {
        uint16 fromChain;
        address token;
        uint256 amount;
        uint256 vaaTimestmp;
        bytes32 fromAddress;
    }

    constructor(address wormholeTokenBridge, address wormholeCCTPBridge)
        MatchingEngineState(wormholeTokenBridge, wormholeCCTPBridge)
    {}

    function executeOrder(bytes calldata vaa) external payable notPaused returns (uint64) {
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
        uint16 emitterChain = vaa.unsafeEmitterChainFromVaa();

        (uint64 sequence, bool filled)  = _executeOrder(
            InternalOrderParameters({
                fromChain: emitterChain,
                token: token,
                amount: denormalizeAmount(transfer.amount, getDecimals(token)),
                vaaTimestmp: vaa.unsafeTimestampFromVaa(),
                fromAddress: transfer.fromAddress
            }),
            transfer.payload.decodeMarketOrder()
        );

        emit OrderExecuted(
            emitterChain,
            vaa.unsafeEmitterAddressFromVaa(),
            vaa.unsafeSequenceFromVaa(),
            sequence,
            filled
        );

        return sequence;
    }

    function executeOrder(
        ICircleIntegration.RedeemParameters calldata redeemParams
    ) external payable notPaused returns (uint64) {
        /**
         * Mint tokens to this contract. Serves as a reentrancy protection,
         * since the circle integration contract will not allow the wormhole
         * message in the redeemParams to be replayed.
         */
        ICircleIntegration.DepositWithPayload memory deposit = _circleIntegration
            .redeemTokensWithPayload(redeemParams);

        uint16 emitterChain = redeemParams.encodedWormholeMessage.unsafeEmitterChainFromVaa();

        (uint64 sequence, bool filled) = _executeOrder(
            InternalOrderParameters({
                fromChain: emitterChain,
                token: fromUniversalAddress(deposit.token),
                amount: deposit.amount,
                vaaTimestmp: redeemParams.encodedWormholeMessage.unsafeTimestampFromVaa(),
                fromAddress: deposit.fromAddress
            }),
            deposit.payload.decodeMarketOrder()
        );

        emit OrderExecuted(
            emitterChain,
            redeemParams.encodedWormholeMessage.unsafeEmitterAddressFromVaa(),
            redeemParams.encodedWormholeMessage.unsafeSequenceFromVaa(),
            sequence,
            filled
        );

        return sequence;
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

        (sequence, ) = _executeOrder(
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
    ) private returns (uint64 sequence, bool filled) {
        // Verify the to and from route.
        (Route memory fromRoute, Route memory toRoute) = _verifyExecutionRoute(
            params.fromChain,
            params.fromAddress,
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
        uint256 amountOut = _handleSwap(
            params.fromChain,
            order.targetChain,
            fromRoute,
            toRoute,
            amountIn,
            order.minAmountOut
        );

        // If the swap failed, revert the order and refund the redeemer on
        // the origin chain. Otherwise, bridge (or CCTP) the swapped token to the
        // destination chain.
        if (amountOut == 0) {
            if (params.fromChain == _chainId) {
                revert SwapFailed();
            }

            filled = false;
            sequence = _handleBridgeOut(
                params.token,
                amountIn, // Send full amount back.
                params.fromChain,
                fromRoute.router,
                Messages
                    .OrderRevert({
                        reason: RevertType.SwapFailed,
                        refundAddress: order.refundAddress,
                        redeemer: order.sender
                    })
                    .encode(),
                fromRoute.cctp
            );
        } else {
            filled = true;
            sequence = _handleBridgeOut(
                toRoute.target,
                amountOut,
                order.targetChain,
                toRoute.router,
                Messages
                    .Fill({
                        sourceChain: params.fromChain,
                        orderSender: order.sender,
                        redeemer: order.redeemer,
                        redeemerMessage: order.redeemerMessage
                    })
                    .encode(),
                toRoute.cctp && order.targetChain != _chainId
            );
        }
    }

    function _verifyExecutionRoute(
        uint16 fromChain,
        bytes32 fromAddress,
        uint16 targetChain,
        address token
    ) private view returns (Route memory fromRoute, Route memory toRoute) {
        fromRoute = getExecutionRouteState().routes[fromChain];
        toRoute = getExecutionRouteState().routes[targetChain];

        // Verify route.
        if (toRoute.target == address(0)) {
            revert InvalidRoute();
        }

        if (fromRoute.cctp && toRoute.cctp) {
            revert RouteNotAvailable();
        }

        if (fromRoute.target != token) {
            revert RouteMismatch();
        }

        if (fromAddress != fromRoute.router || toRoute.router == bytes32(0)) {
            revert UnregisteredOrderRouter();
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
        if (
            (relayerCount == 0 && getDefaultRelayersState().registered[msg.sender]) ||
            block.timestamp > messageTime + RELAY_TIMEOUT
        ) {
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

    function _handleSwap(
        uint16 fromChain,
        uint16 targetChain,
        Route memory fromRoute,
        Route memory toRoute,
        uint256 amountIn,
        uint256 minAmountOut
    ) private returns (uint256) {
        CurvePoolInfo storage poolState = getCurvePoolState();

        /**
         * Sets the pool address for the from and to chains. If one of the swap legs includes
         * the USDC from the Matching Engine's chain, then the swap pool address is set to the
         * pool address for the other chain. The pool address for the Matching Engine's chain
         * is not set initially, because it is assumed to be included in all registered swap pools.
         */
        (address fromPool, address toPool) = _resolveCurvePools(fromChain, targetChain, poolState);

        // Execute a single swap if the to and from assets live in the same pool. Otherwise,
        // execute two swaps, where the intermediate asset is the native token for the pool.
        if (fromPool == toPool) {
            return _executeSwap(
                fromPool,
                fromRoute.target,
                toRoute.target,
                fromRoute.poolIndex,
                toRoute.poolIndex,
                amountIn,
                minAmountOut
            );
        } else {
            uint256 intermediateAmount = _executeSwap(
                fromPool,
                fromRoute.target,
                poolState.nativeTokenAddress,
                fromRoute.poolIndex,
                poolState.nativeTokenIndex,
                amountIn,
                minAmountOut
            );

            if (intermediateAmount == 0) {
                return 0;
            } else {
                return _executeSwap(
                    toPool,
                    poolState.nativeTokenAddress,
                    toRoute.target,
                    poolState.nativeTokenIndex,
                    toRoute.poolIndex,
                    intermediateAmount,
                    minAmountOut
                );
            }
        }
    }

    function _executeSwap(
        address swapPool,
        address fromToken,
        address toToken,
        int128 fromIndex,
        int128 toIndex,
        uint256 amountIn,
        uint256 minAmountOut
    ) private returns (uint256) {
        SafeERC20.safeIncreaseAllowance(IERC20(fromToken), swapPool, amountIn);

        // Perform the swap. We need to adjust the minAmountOut if the input and
        // output token have different decimals.
        (bool success, bytes memory result) = swapPool.call(
            abi.encodeWithSelector(
                ICurvePool.exchange.selector,
                fromIndex,
                toIndex,
                amountIn,
                adjustDecimalDiff(fromToken, toToken, minAmountOut)
            )
        );

        if (success) {
            return abi.decode(result, (uint256));
        } else {
            // Reset allowance that wasn't spent by the Curve pool.
            SafeERC20.safeDecreaseAllowance(IERC20(fromToken), swapPool, amountIn);
            return 0;
        }
    }

    function _resolveCurvePools(
        uint16 fromChain,
        uint16 targetChain,
        CurvePoolInfo storage poolState
    ) private view returns (address fromPool, address toPool) {
        if (fromChain == _chainId) {
            fromPool = poolState.pool[targetChain];
            toPool = fromPool;
        } else if (targetChain == _chainId) {
            toPool = poolState.pool[fromChain];
            fromPool = toPool;
        } else {
            fromPool = poolState.pool[fromChain];
            toPool = poolState.pool[targetChain];
        }
    }

    function _handleBridgeOut(
        address token,
        uint256 amount,
        uint16 recipientChain,
        bytes32 recipient,
        bytes memory payload,
        bool isCCTP
    ) private returns (uint64 sequence) {
        if (isCCTP) {
            SafeERC20.safeIncreaseAllowance(IERC20(token), address(_circleIntegration), amount);

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
            SafeERC20.safeIncreaseAllowance(IERC20(token), address(_tokenBridge), amount);

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
}