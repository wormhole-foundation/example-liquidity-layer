import { Connection, PublicKey } from "@solana/web3.js";
import "dotenv/config";
import {
    UpgradeManagerProgram,
    ProgramId as UpgradeManagerProgramId,
} from "@wormhole-foundation/example-liquidity-layer-solana/upgradeManager";

import {
    solana,
    getContractAddress,
    getEnv,
} from "../../helpers";

solana.runOnSolana("upgrade-matching-engine", async (chain, signer, log) => {
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const upgradeManagerProgramId = getContractAddress(
      "UpgradeManager",
      chain.chainId,
    ) as UpgradeManagerProgramId;

    const upgradeManager = new UpgradeManagerProgram(connection, upgradeManagerProgramId);

    const buffer = new PublicKey(getEnv("MATCHING_ENGINE_UPGRADE_BUFFER_ACCOUNT"));

    await checkBufferExists(buffer, connection);

    const upgradeIx = await upgradeManager.executeMatchingEngineUpgradeIx({
      owner: new PublicKey(await signer.getAddress()),
      matchingEngineBuffer: buffer,
    });

    const txId = await solana.ledgerSignAndSend(connection, [upgradeIx], []);
    log(`Succesfully upgraded on tx -> ${txId}`);
});

async function checkBufferExists(buffer: PublicKey, connection: Connection) {
  const accInfo = await connection.getAccountInfo(buffer, {
    dataSlice: { offset: 0, length: 8 },
  });

  if (accInfo === null) {
    throw new Error(`Buffer at ${buffer.toString()} not found`);
  }
}
