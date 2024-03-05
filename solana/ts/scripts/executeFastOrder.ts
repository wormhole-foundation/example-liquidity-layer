import { Keypair, Connection, Signer } from "@solana/web3.js";
import { MatchingEngineProgram } from "../src/matchingEngine";
import { USDC_MINT_ADDRESS } from "../tests/helpers";
import {
    ChainId,
    getEmitterAddressEth,
    getSignedVAAWithRetry,
    parseVaa,
} from "@certusone/wormhole-sdk";
import { LiquidityLayerMessage } from "../src";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import * as utils from "./utils";
import yargs from "yargs";
import * as fs from "fs";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";

export const TESTNET_GUARDIAN_RPC: string[] = ["https://api.testnet.wormholescan.io"];

export async function getSignedVaa(
    fromChain: ChainId,
    _sender: string,
    sequence: string,
): Promise<Uint8Array> {
    // Fetch the signed VAA from the guardians.
    const { vaaBytes } = await getSignedVAAWithRetry(
        TESTNET_GUARDIAN_RPC,
        fromChain,
        getEmitterAddressEth(_sender),
        sequence,
        {
            transport: NodeHttpTransport(),
        },
    );

    return vaaBytes;
}

export function getArgs() {
    const argv = yargs.options({
        keyPair: {
            alias: "k",
            describe: "Signer Keypair",
            require: true,
            string: true,
        },
        cfg: {
            alias: "c",
            describe: "config",
            require: true,
            string: true,
        },
        fromChain: {
            alias: "f",
            describe: "fromChain",
            require: true,
            string: true,
        },
        sequence: {
            alias: "s",
            describe: "sequence",
            require: true,
            string: true,
        },
    }).argv;

    if ("keyPair" in argv && "cfg" in argv && "fromChain" in argv && "sequence" in argv) {
        return {
            keyPair: JSON.parse(fs.readFileSync(argv.keyPair, "utf8")),
            cfgJson: JSON.parse(fs.readFileSync(argv.cfg, "utf-8")),
            fromChain: argv.fromChain,
            sequence: argv.sequence,
        };
    } else {
        throw Error("Invalid arguments");
    }
}

async function main() {
    // Owner wallet.
    const { keyPair, cfgJson, fromChain, sequence } = getArgs();
    const cfg = new utils.AppConfig(cfgJson);
    const connection = new Connection(cfg.solanaRpc(), "confirmed");
    const payer = Keypair.fromSecretKey(Uint8Array.from(keyPair));
    const signers: Signer[] = [payer];

    const matchingEngine = new MatchingEngineProgram(
        connection,
        MATCHING_ENGINE_PROGRAM_ID,
        USDC_MINT_ADDRESS,
    );

    const logicLogger = utils.defaultLogger({ label: "logic", level: cfg.logicLogLevel() });

    const signedVaa = await getSignedVaa(
        parseInt(fromChain) as ChainId,
        cfg.unsafeChainCfg(parseInt(fromChain)).endpoint,
        sequence,
    );

    const parsedVaa = parseVaa(signedVaa);
    const fastOrder = LiquidityLayerMessage.decode(parsedVaa.payload).fastMarketOrder;
    if (fastOrder === undefined) {
        throw new Error("Failed to parse FastMarketOrder");
    }

    const fastVaaAccount = derivePostedVaaKey(matchingEngine.coreBridgeProgramId(), parsedVaa.hash);

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    const tx = await matchingEngine.executeOrderTx(
        { payer: payer.publicKey, fastVaa: fastVaaAccount },
        signers,
        {
            computeUnits: 250_000,
            feeMicroLamports: 10,
            nonceAccount: cfg.solanaNonceAccount(),
            addressLookupTableAccounts: [lookupTableAccount!],
        },
        { preflightCommitment: "confirmed", skipPreflight: false },
    );

    await utils.sendTx(connection, tx, logicLogger);
}

main();
