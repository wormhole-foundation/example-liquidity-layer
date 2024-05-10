import { ecosystemChains } from "./index";

export function evmOperatingChains() {
  const { operatingChains } = ecosystemChains.evm;
  if (Array.isArray(operatingChains) && operatingChains.length >= 1) {
    return ecosystemChains.evm.networks.filter((x) => {
      return operatingChains.includes(x.chainId);
    });
  }
  return ecosystemChains.evm.networks;
};


// export async function getSigner(chain: ChainInfo): Promise<ethers.Signer> {
//   const provider = getProvider(chain);
//   const privateKey = loadPrivateKey();

//   if (privateKey === "ledger") {
//     if (process.env.LEDGER_BIP32_PATH === undefined) {
//       throw new Error(`Missing BIP32 derivation path.
// With ledger devices the path needs to be specified in env var 'LEDGER_BIP32_PATH'.`);
//     }
//     const { LedgerSigner } = await import("@xlabs-xyz/ledger-signer");
//     return LedgerSigner.create(provider, process.env.LEDGER_BIP32_PATH);
//   }

//   const signer = new ethers.Wallet(privateKey, provider);
//   return signer;
// }

// export function getProvider(
//   chain: ChainInfo
// ): ethers.providers.StaticJsonRpcProvider {
//   const providerRpc = loadChains().find((x: any) => x.chainId == chain.chainId)?.rpc || "";

//   if (!providerRpc) {
//     throw new Error("Failed to find a provider RPC for chain " + chain.chainId);
//   }

//   let provider = new ethers.providers.StaticJsonRpcProvider(
//     providerRpc,  
//   );

//   return provider;
// }

