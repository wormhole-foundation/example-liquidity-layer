// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import {BytesLib} from "wormhole-solidity/BytesLib.sol";
import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {IOrderRouter, PlaceMarketOrderArgs, OrderResponse, RedeemedFill} from "liquidity-layer/IOrderRouter.sol";
import {IWETH} from "wormhole-solidity/IWETH.sol";

import {NativeSwapBase} from "./NativeSwapBase.sol";
import {fromUniversalAddress} from "./Utils.sol";

contract NativeSwapV2 is NativeSwapBase {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    IUniswapV2Router02 public immutable SWAP_ROUTER;

    constructor(
        address _swapRouterAddress,
        address _wormholeAddress,
        address _orderRouterAddress,
        address _usdcAddress,
        address _wrappedNativeAddress
    ) NativeSwapBase(_wormholeAddress, _orderRouterAddress, _usdcAddress, _wrappedNativeAddress) {
        SWAP_ROUTER = IUniswapV2Router02(_swapRouterAddress);
    }

    /// @dev Calls _swapExactInBeforeTransfer and encodes custom payload with
    /// instructions for executing native asset swaps on the destination chain
    function swapExactNativeInAndTransfer(
        ExactInParameters calldata swapParams,
        address[] calldata path,
        uint16 targetChainId,
        uint256 wormholeSlippage
    ) external payable {
        (bytes32 targetContract, uint256 targetChainRelayerFee) = _verifyInput(
            path,
            swapParams.amountOutMinimum,
            targetChainId,
            wormholeSlippage
        );

        // cache wormhole fee and check msg.value
        uint256 wormholeFee = WORMHOLE.messageFee();
        require(msg.value > WORMHOLE.messageFee(), "insufficient value");

        // wrap native asset
        IWETH(WRAPPED_NATIVE_ADDRESS).deposit{
            value : msg.value - wormholeFee
        }();

        // `amountOut` is the USDC amount that was received from the swap
        uint256 amountOut = _swapExactInBeforeTransfer(
            msg.value - wormholeFee,
            swapParams.amountOutMinimum,
            path[0:2],
            swapParams.deadline
        );

        // approve USDC integration contract to spend USDC
        SafeERC20.safeIncreaseAllowance(
            IERC20(USDC_ADDRESS),
            address(ORDER_ROUTER),
            amountOut
        );

        ORDER_ROUTER.placeMarketOrder{value: wormholeFee}(
            PlaceMarketOrderArgs({
                amountIn: amountOut,
                minAmountOut: swapParams.amountOutMinimum - wormholeSlippage,
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
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // approve the router to spend tokens
        SafeERC20.safeIncreaseAllowance(
            IERC20(path[0]),
            address(SWAP_ROUTER),
            amountIn
        );

        // perform the swap
        uint256[] memory amounts = SWAP_ROUTER.swapExactTokensForTokens(
            amountIn,
            amountOutMinimum,
            path,
            address(this),
            deadline
        );
        amountOut = amounts[1];
    }

    /// @dev Mints USDC and executes exactIn native asset swap and pays the relayer
    function recvAndSwapExactNativeIn(
        OrderResponse calldata orderResponse
    ) external payable returns (uint256[] memory amounts) {
        (
            RecvSwapInParameters memory swapParams,
            uint256 swapAmount
        ) = _handleAndVerifyFill(orderResponse);

        // create dynamic address array, uniswap won't take fixed size array
        address[] memory uniPath = new address[](2);
        uniPath[0] = swapParams.path[0];
        uniPath[1] = swapParams.path[1];

        // convert recipient bytes32 address to type address
        address recipientAddress = fromUniversalAddress(swapParams.recipientAddress);

        // approve the router to spend tokens
        SafeERC20.safeIncreaseAllowance(
            IERC20(uniPath[0]),
            address(SWAP_ROUTER),
            swapAmount
        );

        // try to execute the swap
        try SWAP_ROUTER.swapExactTokensForTokens(
            swapAmount,
            swapParams.estimatedAmount,
            uniPath,
            address(this),
            swapParams.deadline
        ) returns (uint256[] memory) {
            _handleSuccessfulSwap(
                amounts[1],
                swapAmount,
                swapParams.relayerFee,
                recipientAddress
            );
            return amounts;
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