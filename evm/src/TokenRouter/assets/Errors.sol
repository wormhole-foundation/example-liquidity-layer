// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

error ErrInvalidRedeemer(bytes32 redeemer, bytes32 expected);

error ErrInvalidRefundAddress();

error ErrInvalidRedeemerAddress();

error ErrInvalidEndpoint(bytes32 endpoint);

error ErrEndpointAlreadyExists(uint16 chain);

error ErrUnsupportedChain(uint16 chain);

error ErrChainNotAllowed(uint16 chain);

error ErrInvalidSourceRouter(bytes32 sender, bytes32 expected);

error ErrInvalidMatchingEngineSender(bytes32 sender, bytes32 expected);

error ErrInvalidChain(uint16 chain);

error ErrInsufficientAmount(uint64 amount, uint64 minAmount);

error ErrInsufficientFastTransferFee();

error ErrAmountTooLarge(uint64 amountIn, uint64 maxAmount);

error ErrFastTransferFeeUnset();

error ErrInvalidFeeInBps();

error ErrInvalidFastTransferParameters();

error ErrFastTransferNotSupported();

error ErrInvalidFeeOverride();

error ErrFastTransferDisabled();

error ErrInvalidMaxFee(uint64 maxFee, uint64 minimumReuiredFee);

error ErrCallerNotDeployer(address deployer, address caller);

error InvalidInitDataLength(uint256 actual, uint256 expected);
