import { AddressLookupTableProgram, Keypair, Connection, PublicKey, Signer } from "@solana/web3.js";
import { MatchingEngineProgram } from "../src/matchingEngine";
import { USDC_MINT_ADDRESS } from "../tests/helpers";
import { PreparedTransaction } from "../src";
import * as utils from "../auction-participant/utils";
import yargs from "yargs";
import * as fs from "fs";
import { getAssociatedTokenAddress } from "@solana/spl-token";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        rpc: {
            alias: "r",
            describe: "rpc",
            require: true,
            string: true,
        },
        nonceAccount: {
            alias: "n",
            describe: "nonce account",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "rpc" in argv && "nonceAccount" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            rpc: argv.rpc,
            nonceAccount: argv.nonceAccount,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function main() {
    // Owner wallet.
    const { keyPair, rpc, nonceAccount } = getArgs();
    const connection = new Connection(rpc, "confirmed");
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));
    const signers: Signer[] = [payer];

    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT_ADDRESS,
    );

    const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
        AddressLookupTableProgram.createLookupTable({
            authority: payer.publicKey,
            payer: payer.publicKey,
            recentSlot: slot,
        }),
    );

    const createTx: PreparedTransaction = {
        ixs: [createIx],
        signers,
        computeUnits: 200_000,
        feeMicroLamports: 10,
        nonceAccount: new PublicKey(nonceAccount),
        confirmOptions: { preflightCommitment: "finalized" },
    };

    await utils.sendTx(connection, createTx);

    const usdcCommonAccounts = await matchingEngine.commonAccounts();

    // Extend.
    const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable,
        addresses: Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
    });

    const extendTx: PreparedTransaction = {
        ixs: [extendIx],
        signers,
        computeUnits: 200_000,
        feeMicroLamports: 10,
        nonceAccount: new PublicKey(nonceAccount),
        confirmOptions: { preflightCommitment: "finalized" },
    };
    await utils.sendTx(connection, extendTx);

    // Other accounts to extend.
    const accountsToExtend: PublicKey[] = [];

    // Extend the lookup table with accounts that are unique to the payer.
    accountsToExtend.push(new PublicKey(nonceAccount));
    accountsToExtend.push(matchingEngine.payerSequenceAddress(payer.publicKey));

    // Add token account too.
    const tokenAccount = await getAssociatedTokenAddress(USDC_MINT_ADDRESS, payer.publicKey);
    accountsToExtend.push(tokenAccount);

    // Extend the lookup table with the auction config.
    await (async () => {
        const { auctionConfigId } = await matchingEngine.fetchCustodian();
        const configAddress = matchingEngine.auctionConfigAddress(auctionConfigId + 1);
        accountsToExtend.push(configAddress);
    })();

    // Extend.
    const extendIx2 = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable,
        addresses: accountsToExtend,
    });

    const extendTx2: PreparedTransaction = {
        ixs: [extendIx2],
        signers,
        computeUnits: 200_000,
        feeMicroLamports: 10,
        nonceAccount: new PublicKey(nonceAccount),
    };
    await utils.sendTx(connection, extendTx2);

    console.log("Lookup table created:", lookupTable);
}

main();
