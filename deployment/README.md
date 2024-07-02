# Contracts scrips

### Before start

- Install & Build

```
npm install
npm run build-evm
```

- Add the desired networks where you want to work on the [ecosystem file](./config/testnet/ecosystem.json) with the format:

```
type ChainInfo = {
  name: string;
  chainId: number; // EVM ChainId
  rpc: string;
  type: "Mainnet" | "Testnet" | "Devnet";
  externalId?: string;
}
```

- Configure the dependencies on the [dependencies file](./config/testnet/dependencies.json).

- Add the config for each chain in the [MatchingEngine](./config/testnet/matching-engine.json) config file or the [TokenRouter](./config/testnet/token-router.json) config file.


### EVM scripts

```
npx tsx ./scripts/evm/<ContractName>/<ScriptName>.ts
```

### Solana scripts

```
npx tsx ./scripts/solana/<ContractName>/<ScriptName>.ts
```