# EVM

## Build

Run the following commands to install necessary dependencies and to build the smart contracts:

```
make build
```

## Testing Environment

The testing environments can be found in the following locations:

- [Unit Tests](./forge/tests/)
- [Integration Tests](./ts/tests/)

To run the unit tests, set the `AVAX_RPC` environment variable in `env/testing.env` and run `make unit-test`. To run the integration tests, create a `.env` file in the `ts/tests` directory with the following environment variables:

```
# Mainnet RPC
AVALANCHE_RPC=

# Mainnet RPC
ETHEREUM_RPC=
```

Then run `make integration-test`.

## Contract Deployment

To deploy the `TokenRouter` contract, open the target environment file in the `env` directory and set the `RELEASE_OWNER_ASSISTANT_ADDRESS`. Then run the following command:

```
bash sh/deploy_token_router.sh -u RPC_URL -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME

# Argument examples
-n testnet, mainnet, localnet
-c avalanche, ethereum
```

## Initial Contract Setup

Once the contracts have been deployed, the deployment configuration file needs to be updated with the deployed contract addresses. The configuration file can be found in the `cfg` directory. Open the file of the desired network and update the deployed `router` addresses. Then run the following command:

```
bash sh/configure_token_router.sh -u RPC_URL -k PRIVATE_KEY -n NETWORK_TYPE -c CHAIN_NAME

# Argument examples
-n testnet, mainnet
-c avalanche, ethereum
```
