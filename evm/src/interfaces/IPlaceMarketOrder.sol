// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

struct PlaceMarketOrderArgs {
    // Amount of tokens to transfer.
    uint256 amountIn;
    /**
     * Minimum amount of tokens to receive in exchange for `amountIn`
     * when executing a market order on the MatchingEngine. This
     * parameter is currently unused, but is available to future proof
     * the contract.
     */
    uint256 minAmountOut;
    // The chain ID of the chain to transfer tokens to.
    uint16 targetChain;
    // The address of the redeeming contract on the target chain.
    bytes32 redeemer;
    // Arbitrary payload to be sent to the `redeemer`.
    bytes redeemerMessage;
    /**
     * The address to refund tokens to if the order is reverted. This
     * parameter is currently unused, but is available to future proof
     * the contract.
     */
    address refundAddress;
}

struct PlaceCctpMarketOrderArgs {
    // Amount of tokens to transfer.
    uint256 amountIn;
    // The chain ID of the chain to transfer tokens to.
    uint16 targetChain;
    // The address of the redeeming contract on the target chain.
    bytes32 redeemer;
    // Arbitrary payload to be sent to the `redeemer`.
    bytes redeemerMessage;
}

interface IPlaceMarketOrder {
    /**
     * @notice Place an "order" to transfer USDC to another blockchain.
     * The tokens will be transferred to the `redeemer` contract on the
     * target chain upon redemption.
     * @param args `PlaceMarketOrderArgs` struct.
     * @return sequence The sequence number of the `Fill` Wormhole message.
     * @dev Currently, the `minAmountOut` and `refundAddress` parameters
     * are unused, but are available to future proof the contract. Eventually,
     * there will be a "Hub" contract on one chain that will faciliate transfers
     * of canonical representations of USDC to chains that are not CCTP enabled.
     * If you plan to support non-CCTP enabled chains in the future, use this
     * interface.
     */
    function placeMarketOrder(
        PlaceMarketOrderArgs calldata args
    ) external payable returns (uint64 sequence);

    /**
     * @notice Place an "order" to transfer USDC to a CCTP-enabled blockchain.
     * The tokens will be transferred to the `redeemer` contract on the
     * target chain upon redemption.
     * @param args `PlaceCctpMarketOrderArgs` struct.
     * @return sequence The sequence number of the `Fill` Wormhole message.
     * @dev This interface is for CCTP-enabled chains only. If you plan to
     * support non-CCTP enabled chains in the future, use the other `placeMarketOrder`
     * interface which includes a `minAmountOut` and `refundAddress` parameter.
     */
    function placeMarketOrder(
        PlaceCctpMarketOrderArgs calldata args
    ) external payable returns (uint64 sequence);
}
