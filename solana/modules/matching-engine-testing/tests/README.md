# Matching Engine Tests

## How to read the tests

Each test is found in the `test_scenarios` directory.

Each file in this directory is a module that contains tests for a specific subset of scenarios (instructions).

Each test is a function that is annotated with `#[tokio::test]`.

Each test is a test for a specific scenario, and uses the `TestingEngine` to execute a series of instruction triggers.

The `TestingEngine` is initialised with a `TestingContext`. The `TestingContext` holds the solana program test context, the actors, the transfer direction, created vaas, as well as some constants.

The `TestingEngine` is used to execute the instruction triggers in the order they are provided. See the `testing_engine/engine.rs` file for more details.

## Happy path integration tests

### Initialize program

What is expected:
- Program is initialised
- Router endpoints are created


### Create CCTP router endpoints

What is expected:
- CCTP router endpoints are created

### Create fast market order

What is expected:
- Fast market order account is created
- Guardian set is created
- Fast market order is initialised

### Close fast market order

What is expected:
- Fast market order account is closed
- Guardian set is closed
- Close account refund recipient is sent usdc

### Place initial offer (shimless)

What is expected:
- Fast market order is initialised
- Initial offer is placed
- Auction account is created and corresponds to a vaa and the initial offer

### Place initial offer (shim)

What is expected:
- Fast market order is posted as a vaa
- Initial offer is placed
- Auction account is created and corresponds to a vaa and the initial offer




