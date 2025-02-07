import { Connection, PublicKey } from "@solana/web3.js";
import "dotenv/config";
import {
    UpgradeManagerProgram,
    ProgramId as UpgradeManagerProgramId,
} from "@wormhole-foundation/example-liquidity-layer-solana/upgradeManager";

import {
    solana,
    getContractAddress,
} from "../../helpers";

solana.runOnSolana("upgrade-matching-engine", async (chain, signer, log) => {
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const upgradeManagerProgramId = getContractAddress(
      "UpgradeManager",
      chain.chainId,
    ) as UpgradeManagerProgramId;

    const upgradeManager = new UpgradeManagerProgram(connection, upgradeManagerProgramId);

    const owner = new PublicKey(await signer.getAddress());

    const meCommitUpgradeIx = await upgradeManager.commitMatchingEngineUpgradeIx({
      owner
    });
    const meTxIdCommit = await solana.ledgerSignAndSend(connection, [meCommitUpgradeIx], []);
    log(`Succesfully commited matching engine upgrade on tx -> ${meTxIdCommit}`);

    const trCommitUpgradeIx = await upgradeManager.commitTokenRouterUpgradeIx({
      owner
    });
    const trTxIdCommit = await solana.ledgerSignAndSend(connection, [trCommitUpgradeIx], []);
    log(`Succesfully committed token router upgrade on tx -> ${trTxIdCommit}`);
});
