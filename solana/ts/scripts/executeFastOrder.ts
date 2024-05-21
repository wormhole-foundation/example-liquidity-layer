import { Keypair, Connection, Signer } from "@solana/web3.js";
import { MatchingEngineProgram } from "../src/matchingEngine";
import { USDC_MINT_ADDRESS } from "../src/testing";
import {
    ChainId,
    getEmitterAddressEth,
    getSignedVAAWithRetry,
    parseVaa,
} from "@certusone/wormhole-sdk";
import { LiquidityLayerMessage } from "../src/common";
import { derivePostedVaaKey } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import * as utils from "../auction-participant/utils";
import yargs, { Argv } from "yargs";
import { Command } from 'commander';
import * as fs from "fs";

const MATCHING_ENGINE_PROGRAM_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";

export function getArgs() {
    const program = new Command();

    program
        .requiredOption('-k, --keyPair <keyPair>', 'Signer Keypair')
        .requiredOption('-c, --cfg <cfg>', 'config')
        .requiredOption('-f, --fromChain <fromChain>', 'fromChain')
        .requiredOption('-s, --sequence <sequence>', 'sequence');

    const options = program.opts();

    if ("keyPair" in options && "cfg" in options && "fromChain" in options && "sequence" in options) {
        return {
            keyPair: JSON.parse(fs.readFileSync(options.keyPair, "utf8")),
            cfgJson: JSON.parse(fs.readFileSync(options.cfg, "utf-8")),
            fromChain: options.fromChain,
            sequence: options.sequence,
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

    const vaaResponse = await utils.fetchVaaFromWormscan(
        cfg,
        {
            chain: parseInt(fromChain),
            sequence: parseInt(sequence),
            emitter: getEmitterAddressEth(cfg.unsafeChainCfg(parseInt(fromChain)).endpoint),
        },
        logicLogger,
    );

    const parsedVaa = parseVaa(vaaResponse.vaa!);
    const fastOrder = LiquidityLayerMessage.decode(parsedVaa.payload).fastMarketOrder;
    if (fastOrder === undefined) {
        throw new Error("Failed to parse FastMarketOrder");
    }

    const fastVaaAccount = derivePostedVaaKey(matchingEngine.coreBridgeProgramId(), parsedVaa.hash);

    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
        cfg.solanaAddressLookupTable(),
    );

    const tx = await matchingEngine.executeFastOrderTx(
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
