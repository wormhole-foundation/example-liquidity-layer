import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import {
    ChainId,
    parseVaa,
    parseTransferPayload,
    CHAIN_ID_SOLANA,
    getIsTransferCompletedSolana,
} from "@certusone/wormhole-sdk";
import * as tokenBridgeRelayer from "../../src";
import {
    RPC,
    TOKEN_BRIDGE_PID,
    TOKEN_ROUTER_PID,
    CORE_BRIDGE_PID,
    FEE_RECIPIENT,
} from "../helpers/consts";
import { sendAndConfirmIx, postVaaOnSolana, createATAForRecipient } from "../helpers/utils";
import yargs from "yargs";
import * as fs from "fs";

// Token Bridge Relayer program ID.
const PROGRAM_ID = new PublicKey(TOKEN_ROUTER_PID);
const PROGRAM_ID_HEX = Buffer.from(PROGRAM_ID.toBytes()).toString("hex");

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        vaa: {
            alias: "vaa",
            describe: "VAA to submit",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "vaa" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            vaa: argv.vaa,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function relay(connection: Connection, payer: Keypair, vaa: string) {
    // Convert VAA string to buffer.
    const signedVaa = Buffer.from(vaa, "hex");

    // Check to see if the VAA has been redeemed already.
    const isRedeemed = await getIsTransferCompletedSolana(
        new PublicKey(TOKEN_BRIDGE_PID),
        signedVaa,
        connection
    );
    if (isRedeemed) {
        console.log("VAA has already been redeemed");
        return;
    }

    // Parse the VAA.
    const parsedVaa = parseVaa(signedVaa);

    // Make sure it's a payload 3.
    const payloadType = parsedVaa.payload.readUint8(0);
    if (payloadType != 3) {
        console.log("Not a payload 3");
        return;
    }

    // Parse the payload.
    const transferPayload = parseTransferPayload(parsedVaa.payload);

    // Confirm that the destination is the relayer contract.
    if (transferPayload.targetAddress != PROGRAM_ID_HEX) {
        console.log("Destination is not the relayer contract");
        return;
    }

    // Confirm that the sender is a registered relayer contract.
    const registeredForeignContract = await tokenBridgeRelayer.getForeignContractData(
        connection,
        TOKEN_ROUTER_PID,
        parsedVaa.emitterChain as ChainId
    );
    if (registeredForeignContract.address.toString("hex") !== transferPayload.fromAddress) {
        console.log("Sender is not a registered relayer contract");
        return;
    }

    // Post the VAA on chain.
    try {
        await postVaaOnSolana(connection, payer, new PublicKey(CORE_BRIDGE_PID), signedVaa);
    } catch (e) {
        console.log(e);
    }

    // Parse the recipient address from the additional payload.
    const recipientInPayload = parsedVaa.payload.subarray(198, 230);
    const recipient = new PublicKey(recipientInPayload);

    // Create the associated token account for the recipient if it doesn't exist.
    await createATAForRecipient(
        connection,
        payer,
        new PublicKey(TOKEN_BRIDGE_PID),
        recipient,
        transferPayload.originChain as ChainId,
        Buffer.from(transferPayload.originAddress, "hex")
    );

    // See if the token being transferred is native to Solana.
    const isNative = transferPayload.originChain == CHAIN_ID_SOLANA;

    // Create the redemption instruction. There are two different instructions
    // depending on whether the token is native or not.
    const completeTransferIx = await (isNative
        ? tokenBridgeRelayer.createCompleteNativeTransferWithRelayInstruction
        : tokenBridgeRelayer.createCompleteWrappedTransferWithRelayInstruction)(
        connection,
        TOKEN_ROUTER_PID,
        payer.publicKey,
        new PublicKey(FEE_RECIPIENT),
        TOKEN_BRIDGE_PID,
        CORE_BRIDGE_PID,
        signedVaa,
        recipient
    );

    // Send the transaction.
    const tx = await sendAndConfirmIx(
        connection,
        completeTransferIx,
        payer,
        250000 // compute units
    );
    if (tx === undefined) {
        console.log("Transaction failed.");
    } else {
        console.log("Transaction successful:", tx);
    }
}

async function main() {
    // Set up provider.
    const connection = new Connection(RPC, "confirmed");

    // Owner wallet.
    const { keyPair, vaa } = getArgs();
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));

    // Relay VAA.
    await relay(connection, payer, vaa);
}

main();
