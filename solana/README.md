# Example Liquidity Layer on Solana

## Assets

- Matching Engine
- Token Router
- Upgrade Manager

## Dependencies

- cargo -- Get started using [rustup](https://rustup.rs/)
- npm -- Get started using [nvm](https://github.com/nvm-sh/nvm?tab=readme-ov-file#install--update-script)
- solana -- Install the latest version [here](https://docs.solanalabs.com/cli/install#use-solanas-install-tool)
- anchor -- Install [avm](https://book.anchor-lang.com/getting_started/installation.html#anchor)

## Build

Currently there are two features that represent target Solana
networks:

- localnet (Solana Test Validator)
- testnet (Solana devnet)

Make sure the program pubkeys for whichever network you plan on deploying for is set as the correct
const values found in [this lib.rs file](modules/common/src/lib.rs).

So for testnet, you would specify the NETWORK env and execute `make build`. For example:

```sh
NETWORK=testnet make build
```

This will create an artifacts directory (in the example above, _artifacts_testnet_).

## Tests

To run both unit and integration tests, run `make test`.

## Deployment

First [build](#build) for a specific network.

Following the same example in the build section, assuming your keypair reflects the Upgrade
Manager's pubkey `ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt`, you would deploy a new program by
running the following command using the Solana CLI:

```sh
solana program deploy -u d --program-id ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt artifacts-testnet/upgrade_manager.so
```

## Managing Upgrades

TODO: Discuss Upgrade Manager.

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
Ensure that your private key is securely stored in the `.env` file under the `SOLANA_PRIVATE_KEY`
variable. This key is essential for signing transactions and interacting with the blockchain.
Format the private key as a base64 string before adding it to the `.env` file.

### Vaa Auction Relayer

The `vaaAuctionRelayer` listens for `FastMarketOrder` VAAs emitted by the Liquidity Layer's network
of contracts. It determines if the `maxFee` encoded in the `FastMarketOrder` VAA is high enough to
participate in an auction, if it is, it executes a `place_initial_offer` instruction on the Solana
`MatchingEngine`.

If any known token accounts are the highest bidder at the end of an auction, this process will settle
the auction by executing the `settle_auction_complete` instruction and posting the finalized VAA
associated with the auction's `FastMarketOrder` VAA. For the `vaaAuctionRelayer` to recognize executed
fast transfers and execute the `settle_auction_complete` instruction, add the owner's public key to the
`knownAtaOwners` array field in the configuration file.

The `vaaAuctionRelayer` relies on the [Beacon](https://github.com/pyth-network/beacon) as the `VaaSpy` to listen for `FastMarketOrder` VAAs. To set up the
Beacon, increase the UDP buffer size for the OS:

```sh
# for linux
sudo sysctl -w net.core.rmem_max=2097152
sudo sysctl -w net.core.rmem_default=2097152
# for macos
sudo sysctl -w net.inet.udp.recvspace=2097152
```

Then, make sure Docker is running and execute the following command to run Beacon in a detached mode:

```sh
make wormhole-spy-up NETWORK=testnet
```

To stop or restart the beacon

```sh
make wormhole-spy-down
make wormhole-spy-restart NETWORK=testnet
```

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
