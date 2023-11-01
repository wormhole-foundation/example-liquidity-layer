// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Messages} from "../../shared/Messages.sol";

abstract contract MatchingEngine {
    using BytesParsing for bytes;
    using Messages for *;

    function placeBid(bytes calldata fastTransferVaa, uint256 bidPrice) external {
        // Check to see if hash of VAA is saved, if it isn't, this is the first bid.
        // * start the timer
        // * save the bid price if it's greater than the encoded fee
        // * custody the funds and escrow amount
        // * save highest bidders address
        // * only save new bids if they are lower than other ones
        // * kick out bad bids back to other bidder
        // * stop accepting bids after n amount of seconds.
    }

    function executeFastOrder(bytes calldata fastTransferVaa) external {
        // Check to see if the timer has expired
        // Make sure it's within grace period
        // Divide up funds based on grace period
        // execute
    }

    function executeOrder(bytes calldata fastTransferVaa) external {

    }
}