import { ethers } from "ethers";

export function parseEvmEvent(
  txReceipt: ethers.ContractReceipt,
  contractAddress: string,
  eventInterface: string
) {
  for (const txLog of txReceipt.logs) {
    if (txLog.address === contractAddress) {
      const iface = new ethers.utils.Interface([`event ${eventInterface}`]);
      return iface.parseLog(txLog).args;
    }
  }

  throw new Error("contract address not found");
}
