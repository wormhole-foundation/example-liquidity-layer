// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

interface ITokenRouterEvents {
    /**
     * @notice Emitted when a fill is redeemed by this contract.
     * @param emitterChainId Wormhole chain ID of emitter on the source chain.
     * @param emitterAddress Address (bytes32 zero-left-padded) of emitter on the source chain.
     * @param sequence Sequence of the Wormhole message.
     */
    event FillRedeemed(
        uint16 indexed emitterChainId, bytes32 indexed emitterAddress, uint64 indexed sequence
    );
}