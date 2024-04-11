# Example Liquidity Layer on Solana

## Dependencies

- TODO

## Build

- `make`

## Tests

To run both unit and integration tests, run `make test`.

## Deployment

- TODO

## Testnet Example Solver

The example solver is split up into three processes: `vaaAuctionRelayer`, `improveOffer` and
`executeOrder`. All three rely on the same configuration file, which can created by copying the
sample file `cfg/testnet/sample.config.json`.

To get started, create a durable nonce account (see these
[instructions](https://solana.com/developers/guides/advanced/introduction-to-durable-nonces)) with
your Solana keypair. Copy the public key and move it to the `nonceAccount` field in your config.

**NOTE: We encourage using a durable nonce to avoid an expired blockhash error in case there is
network congestion. We demonstrate how to use this nonce account in the `vaaAuctionRelayer`
process.**

Next, you'll need an RPC for each network that you wish to relay `FastMarketOrders` from. Add each
RPC to the config for the corresponding chain name.

Finally, you will need a funded USDC Associated Token Account (ATA), whose owner is your keypair.

### Vaa Auction Relayer

The `vaaAuctionRelayer` listens for `FastMarketOrder` VAAs emitted by the Liquidity Layer's network
of contracts. It determines if the `maxFee` encoded in the `FastMarketOrder` VAA is high enough to
participate in an auction, if it is, it executes a `place_initial_offer` instruction on the Solana
`MatchingEngine`. If any known token accounts are the highest bidder at the end of an auction, this
process will settle the auction by executing the `settle_auction_complete` instruction and posting
the finalized VAA associated with the auction's `FastMarketOrder` VAA.

To run the `vaaAuctionRelayer` execute the following command:

```sh
npx ts-node ts/auction-participant/vaaAuctionRelayer/app.ts path/to/config/your.config.json
```

### Improve Offers

The `improveOffer` process listens for `AuctionUpdated` events on the `MatchingEngine` via
websocket. Once an auction has been initiated, this process will determine if it is willing to
improve the offer based on the `pricing` parameters in your config.

To run the `improveOffer` script, execute the following command:

```sh
npx ts-node ts/auction-participant/improveOffer/app.ts path/to/config/your.config.json
```

### Execute Fast Orders

The `executeOrder` process listens for `AuctionUpdated` events on the `MatchingEngine` via
websocket. At the end of an auction's duration (see `endSlot` of the `AuctionUpdated` event), this
process will execute the order reflecting this auction within the auction's grace period.

**NOTE: You will need an address lookup table for the execute order instructions because these
instructions require so many accounts. This LUT address can be added to your config.**

To run the `executeOrder` script, execute the following command:

```sh
npx ts-node ts/auction-participant/executeOrder/app.ts path/to/config/your.config.json
```
