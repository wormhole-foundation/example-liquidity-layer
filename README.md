# example-liquidity-layer

The Example Liquidity Layer utilizes the [Wormhole Circle Integration]() contract to faciliate cross-chain transfers of USDC (along with arbitrary messages) to custom smart contracts on any CCTP-enabled blockchain.

## Get Started

Clone the repo using the following command to make sure that all necessary submodules are installed:

```
git clone git@github.com:wormhole-foundation/example-liquidity-layer.git --recurse-submodules
```

## Prerequisites

### EVM

Install [Foundry tools](https://book.getfoundry.sh/getting-started/installation), which include `forge`, `anvil` and `cast` CLI tools.

## Build, Test and Deploy Smart Contracts

Each directory represents Wormhole integrations for specific blockchain networks. Please navigate to a network subdirectory to see more details (see the relevant README.md) on building, testing and deploying the smart contracts.

[Wormhole Circle Integration]: https://github.com/wormhole-foundation/wormhole-circle-integration/blob/main/DESIGN.md
