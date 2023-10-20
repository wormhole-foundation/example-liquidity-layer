// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {IWETH} from "wormhole-solidity/IWETH.sol";
import {BytesLib} from "wormhole-solidity/BytesLib.sol";
import {IOrderRouter, OrderResponse, RedeemedFill} from "liquidity-layer/interfaces/IOrderRouter.sol";
import {Messages} from "liquidity-layer/shared/Messages.sol";

abstract contract NativeSwapBase {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    // consts
    uint8 public SWAP_FAILED = 0;
    uint8 public SWAP_SUCCEEDED = 1;

    // immutables
    address public immutable deployer;
    IWormhole public immutable WORMHOLE;
    IOrderRouter public immutable ORDER_ROUTER;
    address public immutable USDC_ADDRESS;
    address public immutable WRAPPED_NATIVE_ADDRESS;

    // state variables
    mapping(uint16 => bytes32) public registeredContracts;
    mapping(uint16 => uint256) public relayerFees;

    event SwapResult(
        address indexed _recipient,
        address _tokenOut,
        address _from,
        uint256 _amountOut,
        uint8 _success
    );

    struct ExactInParameters {
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint256 targetAmountOutMinimum;
        bytes32 targetChainRecipient;
        uint256 deadline;
        uint24 poolFee;
    }

    struct RecvSwapInParameters {
        uint256 estimatedAmount;
        bytes32 recipientAddress;
        address[2] path;
        uint256 deadline;
        uint24 poolFee;
        uint256 relayerFee;
    }

    constructor(
        address _wormholeAddress,
        address _orderRouterAddress,
        address _usdcAddress,
        address _wrappedNativeAddress
    ) {
        deployer = msg.sender;
        WORMHOLE = IWormhole(_wormholeAddress);
        ORDER_ROUTER = IOrderRouter(_orderRouterAddress);
        USDC_ADDRESS = _usdcAddress;
        WRAPPED_NATIVE_ADDRESS = _wrappedNativeAddress;
    }

    // ------------------------------ Public ------------------------------ //

    function handleOrderRevert(OrderResponse calldata response) external {
        // This pattern is relatively safe considering that the USDC address
        // is allowlisted. The only way that this could fail is if the USDC
        // contract is malicious. If that's the case, we have bigger problems.
        IERC20 usdc = IERC20(USDC_ADDRESS);
        uint256 balanceBefore = usdc.balanceOf(address(this));
        (, address refundAddress) = ORDER_ROUTER.redeemOrderRevert(response);
        uint256 balanceAfter = usdc.balanceOf(address(this));

        // refund the USDC to the refund address
        usdc.safeTransfer(refundAddress, balanceAfter - balanceBefore);
    }

    function encodeSwapInParameters(
        ExactInParameters memory swapParams,
        address[] memory path,
        uint256 relayerFee
    ) public pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(1),
            swapParams.targetAmountOutMinimum,
            swapParams.targetChainRecipient,
            path[2],
            path[3],
            swapParams.deadline,
            swapParams.poolFee,
            relayerFee
        );
    }

    function decodeSwapInParameters(
        bytes memory encoded
    ) public pure returns (RecvSwapInParameters memory params) {
        uint256 index = 0;

        // payloadId
        uint8 payloadId = encoded.toUint8(index);
        index += 1;
        require(payloadId == 1, "invalid payload");

        // amount out minimum
        params.estimatedAmount = encoded.toUint256(index);
        index += 32;

        // recipient of swapped amount
        params.recipientAddress = encoded.toBytes32(index);
        index += 32;

        // execution path
        params.path[0] = encoded.toAddress(index);
        index += 20;

        params.path[1] = encoded.toAddress(index);
        index += 20;

        // trade deadline
        params.deadline = encoded.toUint256(index);
        index += 32;

        // skip a byte
        index += 1;

        // pool fee
        params.poolFee = encoded.toUint16(index);
        index += 2;

        // relayer fee
        params.relayerFee = encoded.toUint256(index);
        index += 32;

        require(index == encoded.length, "invalid swap payload");
    }

    // ------------------------------ Internal Logic ------------------------------ //

    function _verifyInput(
        address[] calldata path,
        uint256 amountOutMinimum,
        uint16 targetChainId,
        uint256 wormholeSlippage
    ) internal view returns (bytes32 targetContract, uint256 relayerFee) {
        require(path.length == 4, "invalid path");
        require(
            path[0]==WRAPPED_NATIVE_ADDRESS,
            "tokenIn must be wrapped native asset"
        );
        require(
            path[1]==USDC_ADDRESS,
            "tokenOut must be USDC"
        );

        // relayer fee in USDC terms
        relayerFee = relayerFees[targetChainId];
        require(
            amountOutMinimum > relayerFee + wormholeSlippage,
            "insufficient amountOutMinimum"
        );

        targetContract = registeredContracts[targetChainId];
        require(
            targetContract != bytes32(0),
            "target contract not registered"
        );
    }

    function _handleAndVerifyFill(
        OrderResponse calldata orderResponse
    ) internal returns (RecvSwapInParameters memory swapParams, uint256 swapAmount) {
        // This pattern is relatively safe considering that the USDC address
        // is allowlisted. The only way that this could fail is if the USDC
        // contract is malicious. If that's the case, we have bigger problems.
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(address(this));
        RedeemedFill memory fill = ORDER_ROUTER.redeemFill(orderResponse);
        swapAmount = IERC20(USDC_ADDRESS).balanceOf(address(this)) - balanceBefore;

        // verify that the sender is a registered contract
        require(
            fill.sender == registeredContracts[fill.senderChain],
            "fromAddress is not a registered contract"
        );

        // decode the arbitrary payload in the fill
        swapParams = decodeSwapInParameters(
            fill.message
        );

        // sanity check path
        require(
            swapParams.path[0] == USDC_ADDRESS && fill.token == USDC_ADDRESS,
            "tokenIn must be USDC"
        );
        require(
            swapParams.path[1] == WRAPPED_NATIVE_ADDRESS,
            "tokenOut must be wrapped native asset"
        );
    }

    function _handleSuccessfulSwap(
        uint256 amountOut,
        uint256 swapAmount,
        uint256 relayerFee,
        address recipient
    ) internal {
        IWETH(WRAPPED_NATIVE_ADDRESS).withdraw(amountOut);

        // convert relayer fee to native asset
        (uint256 nativeAmountOut, uint256 nativeRelayerFee) = _computeNativeAmounts(
            swapAmount,
            amountOut,
            relayerFee
        );

        // pay the relayer and recipient
        payable(recipient).transfer(nativeAmountOut);
        payable(msg.sender).transfer(nativeRelayerFee);

        emit SwapResult(
            recipient,
            WRAPPED_NATIVE_ADDRESS,
            msg.sender,
            nativeAmountOut,
            SWAP_SUCCEEDED
        );
    }

    function _handleFailedSwap(
        uint256 swapAmount,
        uint256 relayerFee,
        address recipient,
        address swapRouter
    ) internal {
        // pay relayer in the USDC since the swap failed
        IERC20 feeToken = IERC20(USDC_ADDRESS);
        feeToken.safeTransfer(msg.sender, relayerFee);

        // swap failed - return remaining USDC to recipient
        feeToken.safeTransfer(
            recipient,
            swapAmount - relayerFee
        );

        SafeERC20.safeApprove(
            IERC20(USDC_ADDRESS),
            swapRouter,
            0
        );

        emit SwapResult(
            recipient,
            USDC_ADDRESS,
            msg.sender,
            swapAmount - relayerFee,
            SWAP_FAILED
        );
    }

    function _computeNativeAmounts(
        uint256 amountIn,
        uint256 amountOut,
        uint256 usdcFee
    ) internal pure returns (uint256 nativeFee, uint256 adjustedAmountOut) {
        nativeFee = amountOut *  usdcFee / amountIn;
        adjustedAmountOut = amountOut - nativeFee;
    }

    // ------------------------------ Deployer Only ------------------------------ //

    function registerContract(uint16 chainId, bytes32 contractAddress) external onlyDeployer {
        // sanity check both input arguments
        require(
            contractAddress != bytes32(0),
            "emitterAddress cannot equal bytes32(0)"
        );
        require(chainId != 0, "chainId must be > 0");

        // update the registeredContracts state variable
        registeredContracts[chainId] = contractAddress;
    }

    function setRelayerFee(uint16 chainId, uint256 fee) external onlyDeployer {
        relayerFees[chainId] = fee;
    }

    modifier onlyDeployer() {
        require(deployer == msg.sender, "caller not the deployer");
        _;
    }

    // necessary for receiving native assets
    receive() external payable {}
}