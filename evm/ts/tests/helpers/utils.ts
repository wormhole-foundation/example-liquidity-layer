import { ethers } from "ethers";

export async function mineWait(
  provider: ethers.providers.StaticJsonRpcProvider,
  tx: ethers.ContractTransaction
) {
  await provider.send("evm_mine", []);
  return tx.wait();
}
