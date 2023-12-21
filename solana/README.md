# Example Token Router on Solana

## Dependencies

> **Warning**
> Only Solana versions >= 1.14.14 and < 1.15 are supported.

First, you will need `cargo` and `anchor` CLI tools. If you need these tools,
please visit the [Anchor book] for more details.

## Build

Once you have the above CLI tools, you can build the programs by simply running:

- `NETWORK=testnet make`

This will also install this subdirectory's dependencies, such as
`node_modules` and the Wormhole programs from the `solana` directory of the
[Wormhole repo]. This will also create a keypair for the program in the
`target/deploy/`. This keypair can be used for devnet, testnet and mainnet. Do not delete this
key after deploying to the network of your choice.

## Tests

To run both unit and integration tests, run `make test`. If you want to isolate
your testing, use either of these commands:

- `make unit-test` - Runs `cargo clippy` and `cargo test`
- `make integration-test` - Spawns a solana local validator and uses `ts-mocha`
  with `@solana/web3.js` to interact with the example programs.

## Deployment

First, generate a program public key by running the following command:

- `solana-keygen pubkey target/deploy/token_bridge_relayer-keypair.json`

Add your program's public key to the following file:

- `programs/src/lib.rs`

Then, build based on the target network. The deployment options are `devnet`, `testnet` and `mainnet`. We will use `testnet` as an example for this README.

- `NETWORK=testnet make build`

Next, we will need to create some keypairs for the deployment. The keypair that is used to deploy the program will become the `owner` of the program. Optionally, you can create a new keypair for the `assistant` and the `fee_recipient`, however, the same keypair can be used for all three. Create the keypair(s) in a location of your choice by running:

- `solana-keygen new -o path/to/keypair.json`

Then set the `FEE_RECIPIENT`, `ASSISTANT` and `TOKEN_ROUTER_PID` in the `env/tesnet.env` file. This env file will be used for your deployment, as well as setting up the program.

Finally, deploy the program (from the `solana`) directory with the following command:

```
solana program deploy target/deploy/token_bridge_relayer.so \
  --program-id target/deploy/token_bridge_relayer-keypair.json \
  --commitment confirmed \
  -u your_testnet_rpc \
  -k your_deployment_keypair.json`
```

## Program Setup

### Step 1: Env File

You should still have your environment file from the [deployment](#deployment) section of this README. However (if you deleted it) create a new one and set the `FEE_RECIPIENT`, `ASSISTANT` and `TOKEN_ROUTER_PID` environment variables.

### Step 2: Setup Configuration File

Depending on your target network, there should be an example config file in the `cfg` directory. Open your file of choice and configure it to your liking. DO NOT change the name of this file.

### Step 3: Initialize the program

Run the following command to initialize the program. Make sure to supply the keypair that was used to deploy the program:

- `source env/testnet.env && yarn initialize -k your_deployment_keypair.json`

### Step 4: Register Foreign Contracts

- `source env/testnet.env && yarn register-contracts -k your_deployment_keypair.json -n testnet`

### Step 5: Register Tokens (Sets Swap Rate and Max Swap Amount)

- `source env/testnet.env && yarn register-tokens -k your_deployment_keypair.json -n testnet`

### Step 6: Set Relayer Fees

- `source env/testnet.env && yarn set-relayer-fees -k your_deployment_keypair.json -n testnet`

[anchor book]: https://book.anchor-lang.com/getting_started/installation.html
[wormhole repo]: https://github.com/wormhole-foundation/wormhole/tree/dev.v2/solana
