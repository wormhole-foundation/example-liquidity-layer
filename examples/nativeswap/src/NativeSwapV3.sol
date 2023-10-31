// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import {BytesLib} from "wormhole-solidity/BytesLib.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {ITokenRouter, PlaceMarketOrderArgs, OrderResponse, RedeemedFill} from "liquidity-layer/ITokenRouter.sol";
import {IWETH} from "wormhole-solidity/IWETH.sol";

import "./interfaces/IUniswap.sol";

import {NativeSwapBase} from "./NativeSwapBase.sol";
import {fromUniversalAddress} from "./Utils.sol";

contract NativeSwapV3 is NativeSwapBase {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    IUniswapRouter public immutable SWAP_ROUTER;

    constructor(
        address _swapRouterAddress,
        address _wormholeAddress,
        address _orderRouterAddress,
        address _usdcAddress,
        address _wrappedNativeAddress
    ) NativeSwapBase(_wormholeAddress, _orderRouterAddress, _usdcAddress, _wrappedNativeAddress) {
        SWAP_ROUTER = IUniswapRouter(_swapRouterAddress);
    }

    /// @dev Calls _swapExactInBeforeTransfer and encodes custom payload with
    /// instructions for executing native asset swaps on the destination chain
    function swapExactNativeInAndTransfer(
        ExactInParameters calldata swapParams,
        address[] calldata path,
        uint16 targetChainId
    ) external payable {
        (bytes32 targetContract, uint256 targetChainRelayerFee) = _verifyInput(
            path,
            swapParams.amountOutMinimum,
            targetChainId
        );

        // cache wormhole fee and check msg.value
        uint256 wormholeFee = WORMHOLE.messageFee();
        require(msg.value > WORMHOLE.messageFee(), "insufficient value");

        // peform the first swap
        uint256 amountOut = _swapExactInBeforeTransfer(
            msg.value - wormholeFee,
            swapParams.amountOutMinimum,
            path[0:2],
            swapParams.deadline,
            swapParams.poolFee
        );

        // approve USDC integration contract to spend USDC
        SafeERC20.safeIncreaseAllowance(
            IERC20(USDC_ADDRESS),
            address(TOKEN_ROUTER),
            amountOut
        );

        TOKEN_ROUTER.placeMarketOrder{value: wormholeFee}(
            PlaceMarketOrderArgs({
                amountIn: amountOut,
                minAmountOut: 0, // Ignore parameter.
                targetChain: targetChainId,
                redeemer: targetContract,
                redeemerMessage: encodeSwapInParameters(swapParams, path, targetChainRelayerFee),
                refundAddress: msg.sender
            })
        );
    }

    function _swapExactInBeforeTransfer(
        uint256 amountIn,
        uint256 amountOutMinimum,
        address[] calldata path,
        uint256 deadline,
        uint24 poolFee
    ) internal returns (uint256 amountOut) {
        // set swap options with user params
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: path[0],
                tokenOut: path[1],
                fee: poolFee,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            });

        // perform the swap
        amountOut = SWAP_ROUTER.exactInputSingle{value: amountIn}(params);
    }

    /// @dev Mints USDC and executes exactIn native asset swap and pays the relayer
    function recvAndSwapExactNativeIn(
        OrderResponse calldata orderResponse
    ) external returns (uint256 amountOut) {
        (
            RecvSwapInParameters memory swapParams,
            uint256 swapAmount
        ) = _handleAndVerifyFill(orderResponse);

        // convert recipient bytes32 address to type address
        address recipientAddress = fromUniversalAddress(swapParams.recipientAddress);

        // approve the router to spend tokens
        SafeERC20.safeIncreaseAllowance(
            IERC20(swapParams.path[0]),
            address(SWAP_ROUTER),
            swapAmount
        );

        // try to execute the swap
        try SWAP_ROUTER.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: swapParams.path[0],
                tokenOut: swapParams.path[1],
                fee: swapParams.poolFee,
                recipient: address(this),
                deadline: swapParams.deadline,
                amountIn: swapAmount,
                amountOutMinimum: swapParams.estimatedAmount,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256) {
            _handleSuccessfulSwap(
                amountOut,
                swapAmount,
                swapParams.relayerFee,
                recipientAddress
            );
            return amountOut;
        } catch {
            _handleFailedSwap(
                swapAmount,
                swapParams.relayerFee,
                recipientAddress,
                address(SWAP_ROUTER)
            );
        }
    }
}