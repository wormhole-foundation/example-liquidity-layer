# Matching Engine Tests

## How to read the tests

Each test is found in the `test_scenarios` directory.

Each file in this directory is a module that contains tests for a specific subset of scenarios (instructions).

Each test is a function that is annotated with `#[tokio::test]`.

Each test is a test for a specific scenario, and uses the `TestingEngine` to execute a series of instruction triggers.

The `TestingEngine` is initialized with a `TestingContext`. The `TestingContext` holds the the `TestingActors`, the transfer direction, created vaas, as well as some constants.

The `TestingActors` are structs that hold information for any keypair that is setup before the tests are conducted. These include the `owner` the `owner_assistant` and the `Solvers`.

The `TestingEngine` is used to execute the instruction triggers in the order they are provided. See the `testing_engine/engine.rs` file for more details.

## How to run the tests

### Setup for running the tests

The program must be built. This is done by entering the `solana/programs/matching-enginge` directory and running `cargo build-sbf --features mainnet`. With an incorrect `so` file, the tests will not be run against the correct program.

```bash
cd solana/programs/matching-engine
cargo build-sbf --features mainnet
```

### Running the tests

The tests are run by the following command

```bash
cd solana/modules/matching-engine-testing
cargo test-sbf --features mainnet -- --show-output --test-threads 5
```

#### ❗❗ NOTE when running tests
In order to run tests successfully and avoiding an annoying error due to an RpcTimeout, use a low number of `--test-threads`. This will depend on the local machine. The current recommended threads is `5`.


## Happy path integration tests

### Initialize program

What is expected:
- Program is initialized
- Router endpoints are created


### Create CCTP router endpoints

What is expected:
- CCTP router endpoints are created

### Create fast market order

What is expected:
- Fast market order account is created
- Guardian signatures account is created via Verify VAA Shim program, which are the signatures found in the fast market order VAA from the source network.
- Fast market order is initialized

### Close fast market order

What is expected:
- Fast market order account is closed
- Close account refund recipient is sent lamports from the fast market order account

### Place initial offer (shim)

What is expected:
- Fast market order is initialized
- Initial offer is placed
- Auction account is created and corresponds to a vaa and the initial offer

### Place initial offer (shimless)

What is expected:
- Fast market order is posted as a vaa
- Initial offer is placed
- Auction account is created and corresponds to a vaa and the initial offer




