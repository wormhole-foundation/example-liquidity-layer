# EVM

## Build

Run the following commands to install necessary dependencies and to build the smart contracts:

```
make build
```

## Testing Environment

The testing environments can be found in the following locations:

-   [Unit Tests](./forge/tests/)
-   [Integration Tests](./ts/tests/)

To run the unit tests, set the `AVAX_RPC` environment variable in `env/testing.env` and run `make unit-test`. To run the integration tests, create a `.env` file in the `ts/tests` directory with the following environment variables:

```
# Mainnet RPCs
AVALANCHE_RPC=
ETHEREUM_RPC=
ARBITRUM_RPC=
```

Then run `make integration-test`.

## Contract Deployment

Before deploying any contracts, make sure to set the `RPC` environment variable in each environment file in the target `env` directory.

To deploy the `MatchingEngine` contract, open the `avalanche.env` file in the target `env` directory and set the `RELEASE_FEE_RECIPIENT_ADDRESS` environment variable. The `MatchingEngine` contract is design to be deployed to the Avalanche network to help support faster-than-finality transfers. Run the following command for each network:

```
bash sh/deploy_matching_engine.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME

# Argument examples
-n testnet, mainnet, localnet
-c avalanche, ethereum
```

To deploy the `TokenRouter` contract, open the target environment file in the `env` directory and set the `RELEASE_OWNER_ASSISTANT_ADDRESS`, `RELEASE_MATCHING_ENGINE_CHAIN` and `RELEASE_MATCHING_ENGINE_ADDRESS` environment variables. The `MatchingEngine` contract must be deployed before any `TokenRouter` contracts. Then run the following command:

```
bash sh/deploy_token_router.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME

# Argument examples
-n testnet, mainnet, localnet
-c avalanche, ethereum
```

## Initial Contract Setup

Once the contracts (`TokenRouter` and `MatchingEngine`) have been deployed, the deployment configuration file needs to be updated with the deployed contract addresses, initial `FastTransferParameters` and `AuctionConfig`. The configuration file can be found in the `cfg` directory. Copy the sample testnet file and replace the network type with your network of choice. Run the following commands for each `TokenRouter` contract (in the following order):

```
bash sh/setup_token_router.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME
bash sh/set_fast_transfer_parameters.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME
```

Run the following commands for the `MatchingEngine` contract (in the following order):

```
bash sh/setup_matching_engine.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME
bash sh/set_auction_config.sh -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME
```
