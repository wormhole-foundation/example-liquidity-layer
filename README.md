# example-liquidity-layer

The Example Liquidity Layer utilizes the [Wormhole Circle Integration]() contract to faciliate cross-chain transfers of USDC (along with arbitrary messages) to custom smart contracts on any CCTP-enabled blockchain.

## Get Started

Clone the repo using the following command to make sure that all necessary submodules are installed:

```
git clone git@github.com:wormhole-foundation/example-liquidity-layer.git --recurse-submodules
```

## Prerequisites

### Node version

It is recommended to use `Node v20.18.x`.

```bash
# E.g.
nvm install 20.18.2
nvm use 20.18.2
```

### EVM

Install [Foundry tools](https://book.getfoundry.sh/getting-started/installation), which include `forge`, `anvil` and `cast` CLI tools.

Before using the typescript SDK, build the evm types by running `npm run build` *inside* the `evm` directory. Without this step, the typescript SDK will not be able to be interpreted by the typescript compiler.

## Build, Test and Deploy Smart Contracts

Each directory represents Wormhole integrations for specific blockchain networks. Please navigate to a network subdirectory to see more details (see the relevant README.md) on building, testing and deploying the smart contracts.

[Wormhole Circle Integration]: https://github.com/wormhole-foundation/wormhole-circle-integration/blob/main/DESIGN.md


### Typescript SDK

To use the Typescript SDK, at the root of this repository, run:

```sh
npm ci && npm run build && npm run pack
```

Which will produce a `.tgz` file that can be installed using npm or any other package manager like:

```sh
npm install /path/to/example-liquidity-layer/wormhole-foundation-example-liquidity-layer-solana-0.0.1.tgz
```

Once installed, it can be used like any other package:

```ts
// ...
import * as tokenRouterSdk from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import {
  LiquidityLayerDeposit,
  LiquidityLayerMessage,
} from "@wormhole-foundation/example-liquidity-layer-solana/common";
import { PreparedOrder } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter/state";
// ...
```

