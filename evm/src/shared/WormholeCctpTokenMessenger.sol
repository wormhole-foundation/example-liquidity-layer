// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {IMessageTransmitter} from "cctp-solidity/IMessageTransmitter.sol";
import {ITokenMessenger} from "cctp-solidity/ITokenMessenger.sol";
import {ITokenMinter} from "cctp-solidity/ITokenMinter.sol";

import {Utils} from "./Utils.sol";
import {WormholeCctpMessages} from "./WormholeCctpMessages.sol";

/**
 * @notice A way to associate a CCTP token burn message with a Wormhole message.
 * @dev To construct the contract, the addresses to the Wormhole Core Bridge and CCTP Token
 * Messenger must be provided. Using the CCTP Token Messenger, the Message Transmitter and Token
 * Minter are derived.
 *
 * NOTE: For more information on CCTP message formats, please refer to the following:
 * https://developers.circle.com/stablecoins/docs/message-format.
 */
abstract contract WormholeCctpTokenMessenger {
    using Utils for address;
    using SafeERC20 for IERC20;
    using WormholeCctpMessages for *;

    /**
     * @dev Parsing and verifying VAA reverted at the Wormhole Core Bridge contract level.
     */
    error InvalidVaa();

    /**
     * @dev The CCTP message's source domain, destination domain and nonce must match the VAA's.
     * NOTE: This nonce is the one acting as the CCTP message sequence (and not the arbitrary one
     * specified when publishing Wormhole messages).
     */
    error CctpVaaMismatch(uint32, uint32, uint64);

    /**
     * @dev Wormhole message finality. This value indicates a "finalized" consistency level, where
     * finalized means the transaction where this message (event) lives will not be rolled back.
     */
    uint8 constant _MESSAGE_FINALITY = 1;

    /**
     * @dev Wormhole Core Bridge contract address.
     */
    IWormhole immutable _wormhole;

    /**
     * @dev Wormhole Chain ID. NOTE: This is NOT the EVM chain ID.
     */
    uint16 immutable _chainId;

    /**
     * @dev CCTP Message Transmitter contract interface.
     */
    IMessageTransmitter immutable _messageTransmitter;

    /**
     * @dev CCTP Token Messenger contract interface.
     */
    ITokenMessenger immutable _tokenMessenger;

    /**
     * @dev CCTP Token Minter contract interface.
     */
    ITokenMinter immutable _tokenMinter;

    /**
     * @dev CCTP domain for this network (configured by the CCTP Message Transmitter).
     */
    uint32 immutable _localCctpDomain;

    constructor(address wormhole, address cctpTokenMessenger) {
        _wormhole = IWormhole(wormhole);
        _chainId = _wormhole.chainId();

        _tokenMessenger = ITokenMessenger(cctpTokenMessenger);
        _messageTransmitter = _tokenMessenger.localMessageTransmitter();
        _tokenMinter = _tokenMessenger.localMinter();
        _localCctpDomain = _messageTransmitter.localDomain();
    }

    /**
     * @dev A convenience method to set the token spending allowance for the CCTP Token Messenger,
     *  who will ultimately be burning the tokens.
     */
    function setTokenMessengerApproval(address token, uint256 amount) internal {
        IERC20(token).approve(address(_tokenMessenger), amount);
    }

    /**
     * @dev Method to burn tokens via CCTP Token Messenger and publish a Wormhole message associated
     * with the CCTP Token Burn message. The Wormhole message encodes a `Deposit` (ID == 1), which
     * has the same source domain, destination domain and nonce as the CCTP Token Burn message.
     *
     * NOTE: This method does not protect against re-entrancy here because it relies on the CCTP
     * Token Messenger to protect against any possible re-entrancy. We are leaning on the fact that
     * the Token Messenger keeps track of its local tokens, which are the only tokens it allows to
     * burn (and in turn, mint on another network).
     *
     * NOTE: The wormhole message fee is not required to be paid by the transaction sender (so an
     *  integrator can use ETH funds in his contract to pay for this fee if he wants to).
     */
    function burnAndPublish(
        bytes32 destinationCaller,
        uint32 destinationCctpDomain,
        address token,
        uint256 amount,
        bytes32 mintRecipient,
        uint32 wormholeNonce,
        bytes memory payload,
        uint256 wormholeFee
    ) internal returns (uint64 wormholeSequence, uint64 cctpNonce) {
        // Invoke Token Messenger to burn tokens and emit a CCTP token burn message.
        cctpNonce = _tokenMessenger.depositForBurnWithCaller(
            amount, destinationCctpDomain, mintRecipient, token, destinationCaller
        );

        // Publish deposit message via Wormhole Core Bridge.
        wormholeSequence = _wormhole.publishMessage{value: wormholeFee}(
            wormholeNonce,
            token.encodeDeposit(
                amount,
                _localCctpDomain, // sourceCctpDomain
                destinationCctpDomain,
                cctpNonce,
                msg.sender.toUniversalAddress(), // burnSource
                mintRecipient,
                payload
            ),
            _MESSAGE_FINALITY
        );
    }

    /**
     * @dev Method to verify and reconcile CCTP and Wormhole messages in order to mint tokens for
     * the encoded mint recipient. This method will revert with custom errors.
     * NOTE: This method requires the caller to be the mint recipient. The caller is NOT the
     * contract inheriting this abstract to use this internal method, but is msg.sender.
     */
    function verifyVaaAndMint(
        bytes calldata encodedCctpMessage,
        bytes calldata cctpAttestation,
        bytes calldata encodedVaa
    )
        internal
        returns (
            IWormhole.VM memory vaa,
            bytes32 token,
            uint256 amount,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        )
    {
        // First parse and verify VAA.
        vaa = _parseAndVerifyVaa(
            encodedVaa,
            true // revertCustomErrors
        );

        // Decode the deposit message so we can match the Wormhole message with the CCTP message.
        uint32 sourceCctpDomain;
        uint32 destinationCctpDomain;
        uint64 cctpNonce;
        (
            token,
            amount,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            payload
        ) = vaa.decodeDeposit();

        // Finally reconcile messages and mint tokens to the mint recipient.
        token = _matchMessagesAndMint(
            encodedCctpMessage,
            cctpAttestation,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            token,
            true // revertCustomErrors
        );
    }

    /**
     * @dev PLEASE USE `verifyVaaAndMint` INSTEAD. Method to verify and reconcile CCTP and Wormhole
     * messages in order to mint tokens for the encoded mint recipient. This method will revert with
     * Solidity's built-in Error(string).
     * NOTE: This method requires the caller to be the mint recipient. The caller is NOT the
     * contract inheriting this abstract to use this internal method, but is msg.sender.
     */
    function verifyVaaAndMintLegacy(
        bytes calldata encodedCctpMessage,
        bytes calldata cctpAttestation,
        bytes calldata encodedVaa
    )
        internal
        returns (
            IWormhole.VM memory vaa,
            bytes32 token,
            uint256 amount,
            uint32 sourceCctpDomain,
            uint32 destinationCctpDomain,
            uint64 cctpNonce,
            bytes32 burnSource,
            bytes32 mintRecipient,
            bytes memory payload
        )
    {
        // First parse and verify VAA.
        vaa = _parseAndVerifyVaa(
            encodedVaa,
            false // revertCustomErrors
        );

        // Decode the deposit message so we can match the Wormhole message with the CCTP message.
        (
            token,
            amount,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            burnSource,
            mintRecipient,
            payload
        ) = vaa.decodeDeposit();

        // Finally reconcile messages and mint tokens to the mint recipient.
        token = _matchMessagesAndMint(
            encodedCctpMessage,
            cctpAttestation,
            sourceCctpDomain,
            destinationCctpDomain,
            cctpNonce,
            token,
            false // revertCustomErrors
        );
    }

    /**
     * @dev For a given remote domain and token, fetch the corresponding local token, for which the
     * CCTP Token Minter has minting authority.
     */
    function fetchLocalToken(uint32 remoteDomain, bytes32 remoteToken)
        internal
        view
        returns (bytes32 localToken)
    {
        localToken = _tokenMinter.remoteTokensToLocalTokens(
            keccak256(abi.encodePacked(remoteDomain, remoteToken))
        ).toUniversalAddress();
    }

    // private

    function _parseAndVerifyVaa(bytes calldata encodedVaa, bool revertCustomErrors)
        private
        view
        returns (IWormhole.VM memory vaa)
    {
        bool valid;
        string memory reason;
        (vaa, valid, reason) = _wormhole.parseAndVerifyVM(encodedVaa);

        if (!valid) {
            if (revertCustomErrors) {
                revert InvalidVaa();
            } else {
                Utils.revertBuiltIn(reason);
            }
        }
    }

    function _matchMessagesAndMint(
        bytes calldata encodedCctpMessage,
        bytes calldata cctpAttestation,
        uint32 vaaSourceCctpDomain,
        uint32 vaaDestinationCctpDomain,
        uint64 vaaCctpNonce,
        bytes32 burnToken,
        bool revertCustomErrors
    ) private returns (bytes32 mintToken) {
        // Confirm that the caller passed the correct message pair.
        {
            uint32 sourceDomain;
            uint32 destinationDomain;
            uint64 nonce;

            assembly ("memory-safe") {
                // NOTE: First four bytes is the CCTP message version.
                let ptr := calldataload(encodedCctpMessage.offset)

                // NOTE: There is no need to mask here because the types defined outside of this
                // block will already perform big-endian masking.

                // Source domain is bytes 4..8, so shift 24 bytes to the right.
                sourceDomain := shr(192, ptr)
                // Destination domain is bytes 8..12, so shift 20 bytes to the right.
                destinationDomain := shr(160, ptr)
                // Nonce is bytes 12..20, so shift 12 bytes to the right.
                nonce := shr(96, ptr)
            }

            if (
                vaaSourceCctpDomain != sourceDomain || vaaDestinationCctpDomain != destinationDomain
                    || vaaCctpNonce != nonce
            ) {
                if (revertCustomErrors) {
                    revert CctpVaaMismatch(sourceDomain, destinationDomain, nonce);
                } else {
                    Utils.revertBuiltIn("invalid message pair");
                }
            }
        }

        // Call the circle bridge to mint tokens to the recipient.
        _messageTransmitter.receiveMessage(encodedCctpMessage, cctpAttestation);

        // We should trust that this getter will not return the zero address because the TokenMinter
        // will have already minted the valid token for the mint recipient.
        mintToken = fetchLocalToken(vaaSourceCctpDomain, burnToken);
    }
}
