Solvers
-------

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
import { LiquidityLayerDeposit, LiquidityLayerMessage } from "@wormhole-foundation/example-liquidity-layer-solana/common";
import { PreparedOrder } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter/state";
// ...

```

