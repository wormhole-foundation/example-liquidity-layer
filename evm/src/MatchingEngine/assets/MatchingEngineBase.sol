// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWormhole} from "wormhole-solidity/IWormhole.sol";
import {BytesParsing} from "wormhole-solidity/WormholeBytesParsing.sol";
import {Messages} from "../../shared/Messages.sol";

import "./Errors.sol";
import {State} from "./State.sol";
import {getRouterEndpointState, AuctionData, getAuctionInfo} from "./Storage.sol";

abstract contract MatchingEngine is State {
    using BytesParsing for bytes;
    using Messages for *;

    event AuctionStarted(
        bytes32 indexed auctionId, 
        uint256 transferAmount, 
        uint256 startingBid, 
        address bidder
    );
    event NewBid(bytes32 indexed auctionId, uint256 newBid, uint256 oldBid, address bidder);

    // TODO: change encoded relayer fee to uint128
    // TODO: should we only verify the first message to save gas? Or should all 
    // bidders have to pay the gas to make the playing field even? 
    // TODO: should we save the escrow amount and transfer amount in the auction data, 
    // and then let folks participate by using the auction ID? First person get's hosed.
    // TODO: Do we need to protect against reentrancy, even though the `_token` is allow listed?

    function placeBid(bytes calldata fastTransferVaa, uint128 feeBid) external {
        (
            IWormhole.VM memory vm, 
            bool valid, 
            string memory reason
        ) = _wormhole.parseAndVerifyVM(fastTransferVaa);

        if (!valid) {
            revert ErrInvalidWormholeMessage(reason);
        } 

        // Decode the order, which confirms that the VAA is a fast market order type. 
        Messages.FastMarketOrder memory order = fastTransferVaa.decodeFastMarketOrder();

        // Verify that the to and from routers are registered with this contract. 
        _verifyRouterPath(vm.emitterChainId, vm.emitterAddress, order.targetChain);
        
        // Fetch auction information, if it exists.
        AuctionData storage auction = getAuctionInfo().auctions[vm.hash];

        // If this is the first bid, initialize the auction.
        if (auction.startBlock == 0) {
            _handleNewAuction(vm, order, auction, feeBid); 
        } else {
           _handleNewBid(vm, order, auction, feeBid); 
        }
    } 

    function executeFastOrder(bytes calldata fastTransferVaa) external {
        // * Check to see if the timer has expired
        // * Make sure it's within grace period
        // * Divide up funds based on grace period
        // * Execute if caller 
    }

    // ------------------------------- Private ---------------------------------

    function _handleNewAuction(
        IWormhole.VM memory vm, 
        Messages.FastMarketOrder memory order,
        AuctionData storage auction,
        uint128 feeBid
    ) private {
        if (feeBid > order.transferFee) {
            revert ErrBidPriceTooHigh(feeBid, order.transferFee);
        }

        /**
         * Transfer the funds to the contract. The amount that is transfered includes:
         * - The amount being transferred. 
         * - The fee that the bidder is willing to pay.
         * - A "security deposit" to entice the relayer to initiate the transfer in a timely manner.
         * 
         * - @Note we do this before setting state in case the transfer fails.
         */  
        SafeERC20.safeTransferFrom(
            _token, 
            msg.sender, 
            address(this), 
            order.amountIn + feeBid + order.transferFee
        );

        // Set the auction data.
        auction.startBlock = uint128(block.number);
        auction.bidPrice = feeBid;
        auction.bidder = msg.sender;
        auction.sourceChain = vm.emitterChainId; 
        auction.sourceRouter = vm.emitterAddress;
        auction.slowSequence = order.slowSequence;  

        emit AuctionStarted(vm.hash, order.amountIn, feeBid, msg.sender);
    }

    function _handleNewBid(
        IWormhole.VM memory vm, 
        Messages.FastMarketOrder memory order,
        AuctionData storage auction,
        uint128 feeBid
    ) private {
        if (uint128(block.number) - auction.startBlock > AUCTION_DURATION) {
            revert ErrAuctionPeriodExpired();
        }
        if (feeBid >= auction.bidPrice) {
            revert ErrBidPriceTooHigh(feeBid, auction.bidPrice);
        }

        // Transfer the funds to the contract.
        SafeERC20.safeTransferFrom(
            _token, 
            msg.sender, 
            address(this), 
            order.amountIn + feeBid + order.transferFee
        );

        // Refund the previous bidder.
        SafeERC20.safeTransfer(
            _token, 
            auction.bidder, 
            order.amountIn + auction.bidPrice + order.transferFee
        );

        // Update the auction data. 
        auction.bidPrice = feeBid;
        auction.bidder = msg.sender;

        emit NewBid(vm.hash, feeBid, auction.bidPrice, msg.sender);
    }

    function _verifyRouterPath(uint16 chain, bytes32 fromRouter, uint16 targetChain) private view {
        bytes32 expectedRouter = getRouterEndpointState().endpoints[chain];
        if (fromRouter != expectedRouter) {
            revert ErrInvalidSourceRouter(fromRouter, expectedRouter);
        }

        if (getRouterEndpointState().endpoints[targetChain] == bytes32(0)) {
            revert ErrInvalidTargetRouter(targetChain);
        }
    }
}