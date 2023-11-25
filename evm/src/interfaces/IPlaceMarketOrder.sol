// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface IPlaceMarketOrder {
    /**
     * @notice Place an "order" to transfer USDC to another blockchain.
     * The tokens will be transferred to the `redeemer` contract on the
     * target chain upon redemption.
     * @param amountIn Amount of tokens to transfer.
     * @param minAmountOut Minimum amount of tokens to receive in exchange for `amountIn`
     * when executing a market order on the MatchingEngine. This
     * parameter is currently unused, but is available to future proof
     * the contract.
     * @param targetChain The chain ID of the chain to transfer tokens to.
     * @param redeemer The address of the redeeming contract on the target chain.
     * @param redeemerMessage Arbitrary payload to be sent to the `redeemer`.
     * @param refundAddress The address to refund tokens to if the order is reverted. This
     * parameter is currently unused, but is available to future proof
     * the contract.
     * @return sequence The sequence number of the `Fill` Wormhole message.
     * @dev Currently, the `minAmountOut` and `refundAddress` parameters
     * are unused, but are available to future proof the contract. Eventually,
     * there will be a "Hub" contract on one chain that will faciliate transfers
     * of canonical representations of USDC to chains that are not CCTP enabled.
     * If you plan to support non-CCTP enabled chains in the future, use this
     * interface.
     */
    function placeMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) external payable returns (uint64 sequence);

    /**
     * @notice Place an "order" to transfer USDC to a CCTP-enabled blockchain.
     * The tokens will be transferred to the `redeemer` contract on the
     * target chain upon redemption.
     * @param amountIn Amount of tokens to transfer.
     * @param targetChain The chain ID of the chain to transfer tokens to.
     * @param redeemer The address of the redeeming contract on the target chain.
     * @param redeemerMessage Arbitrary payload to be sent to the `redeemer`.
     * @return sequence The sequence number of the `Fill` Wormhole message.
     * @dev This interface is for CCTP-enabled chains only. If you plan to
     * support non-CCTP enabled chains in the future, use the other `placeMarketOrder`
     * interface which includes a `minAmountOut` and `refundAddress` parameter.
     */
    function placeMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage
    ) external payable returns (uint64 sequence);

    function placeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress
    ) external payable returns (uint64 sequence, uint64 fastSequence);

    function placeFastMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage
    ) external payable returns (uint64 sequence, uint64 fastSequence);

    function placeFastMarketOrder(
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        address refundAddress,
        uint128 maxFeeOverride
    ) external payable returns (uint64 sequence, uint64 fastSequence);

    function placeFastMarketOrder(
        uint256 amountIn,
        uint16 targetChain,
        bytes32 redeemer,
        bytes calldata redeemerMessage,
        uint128 maxFeeOverride
    ) external payable returns (uint64 sequence, uint64 fastSequence);
}
