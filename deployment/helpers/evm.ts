import { LedgerSigner }  from "@xlabs-xyz/ledger-signer";
import { ethers } from "ethers";
import { ChainInfo, ecosystemChains, EvmScriptCb, getEnv } from "./index";

export const ETHEREUM_ADDRESS_LENGTH = 40;
export const zeroValues = [
  0, 
  "0x0000000000000000000000000000000000000000", 
  "", 
  false, 
  "0x0000000000000000000000000000000000000000000000000000000000000000", 
  "0.0"
]; 

export async function runOnEvms(scriptName: string, cb: EvmScriptCb) {
  const chains = evmOperatingChains();

  console.log(`Running script on EVMs (${chains.map(c => c.chainId).join(", ")}):`, scriptName);

  const result = chains.map(async chain => {
    const log = (...args: any[]) => console.log(`[${chain.chainId}]`, ...args);
    const signer = await getSigner(chain);
    log(`Starting script. Signer: ${await signer.getAddress()}`);

    try {
      await cb(chain, signer, log);
      log("Success");
    } catch (error) {
      log("Error: ", error);
    }
    console.log();
  });

  await Promise.all(result);
}

export function evmOperatingChains() {
  const { operatingChains } = ecosystemChains.evm;
  if (Array.isArray(operatingChains) && operatingChains.length >= 1) {
    return ecosystemChains.evm.networks.filter((x) => {
      return operatingChains.includes(x.chainId);
    });
  }
  return ecosystemChains.evm.networks;
};

export async function getSigner(chain: ChainInfo): Promise<ethers.Signer> {
  const derivationPath = getEnv("LEDGER_BIP32_PATH");
  const provider = getProvider(chain);
  return LedgerSigner.create(provider, derivationPath);
}

export function getProvider(
  chain: ChainInfo
): ethers.providers.StaticJsonRpcProvider {
  const providerRpc = ecosystemChains.evm.networks.find((x: any) => x.chainId == chain.chainId)?.rpc || "";

  if (!providerRpc) {
    throw new Error("Failed to find a provider RPC for chain " + chain.chainId);
  }

  let provider = new ethers.providers.StaticJsonRpcProvider(
    providerRpc,  
  );

  return provider;
}

