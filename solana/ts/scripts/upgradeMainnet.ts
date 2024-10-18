import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { UpgradeManagerProgram } from "../src/upgradeManager";

const UPGRADE_MANAGER_ID = "4jyJ7EEsYa72REdD8ZMBvHFTXZ4VYGQPUHaJTajsK8SN";

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.mainnet.solana.com", "confirmed");
    const upgradeManager = new UpgradeManagerProgram(connection, UPGRADE_MANAGER_ID);

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    // TODO: update the buffer addresses
    // {
    //     const buffer = new PublicKey("7Ug82c9aZDCNBpjyBsYyZWuBFnphM2K3tSJmYQw6Huev");
    //     await upgradeMatchingEngine(upgradeManager, payer, buffer);
    // }

    // {
    //     const buffer = new PublicKey("2ZKYhV56iaFpHQsdGc2TXdnomVCf3KytCb8ZnjxnLBPN");
    //     await upgradeTokenRouter(upgradeManager, payer, buffer);
    // }
}

async function upgradeMatchingEngine(
    upgradeManager: UpgradeManagerProgram,
    owner: Keypair,
    matchingEngineBuffer: PublicKey,
) {
    const connection = upgradeManager.program.provider.connection;

    const accInfo = await connection.getAccountInfo(matchingEngineBuffer, {
        dataSlice: { offset: 0, length: 8 },
    });
    if (accInfo === null) {
        throw new Error("no buffer found");
    }

    const executeIx = await upgradeManager.executeMatchingEngineUpgradeIx({
        owner: owner.publicKey,
        matchingEngineBuffer,
    });

    const executeTxSig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(executeIx),
        [owner],
        {
            commitment: "finalized",
        },
    ).catch((err) => {
        console.log(err);
        throw err;
    });
    console.log("executed upgrade", executeTxSig);

    const commitIx = await upgradeManager.commitMatchingEngineUpgradeIx({
        owner: owner.publicKey,
    });

    let commitTxSig: string | null = null;
    while (commitTxSig === null) {
        console.log("attempting to commit...");
        await new Promise((r) => setTimeout(r, 2000));

        commitTxSig = await sendAndConfirmTransaction(connection, new Transaction().add(commitIx), [
            owner,
        ]).catch((err) => {
            console.log(err);
            return null;
        });
    }
    console.log("committed upgrade", commitTxSig);
}

async function upgradeTokenRouter(
    upgradeManager: UpgradeManagerProgram,
    owner: Keypair,
    tokenRouterBuffer: PublicKey,
) {
    const connection = upgradeManager.program.provider.connection;

    const accInfo = await connection.getAccountInfo(tokenRouterBuffer, {
        dataSlice: { offset: 0, length: 8 },
    });
    if (accInfo === null) {
        throw new Error("no buffer found");
    }

    const executeIx = await upgradeManager.executeTokenRouterUpgradeIx({
        owner: owner.publicKey,
        tokenRouterBuffer,
    });

    const executeTxSig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(executeIx),
        [owner],
        {
            commitment: "finalized",
        },
    ).catch((err) => {
        console.log(err);
        throw err;
    });
    console.log("executed upgrade", executeTxSig);

    const commitIx = await upgradeManager.commitTokenRouterUpgradeIx({
        owner: owner.publicKey,
    });

    let commitTxSig: string | null = null;
    while (commitTxSig === null) {
        console.log("attempting to commit...");
        await new Promise((r) => setTimeout(r, 2000));

        commitTxSig = await sendAndConfirmTransaction(connection, new Transaction().add(commitIx), [
            owner,
        ]).catch((err) => {
            console.log(err);
            return null;
        });
    }
    console.log("committed upgrade", commitTxSig);
}
