import * as wormholeSdk from "@certusone/wormhole-sdk";
import {
    Connection,
    Keypair,
    PublicKey,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { use as chaiUse } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";
import { UpgradeManagerProgram, testnet } from "../src/upgradeManager";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, programDataAddress } from "../src/utils";
import {
    LOCALHOST,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxOk,
    loadProgramBpf,
} from "./helpers";

// TODO: remove
import "dotenv/config";

chaiUse(chaiAsPromised);

const MATCHING_ENGINE_ARTIFACT_PATH = `${__dirname}/artifacts/testnet_matching_engine.so`;
const TOKEN_ROUTER_ARTIFACT_PATH = `${__dirname}/artifacts/testnet_token_router.so`;

/// FOR NOW ONLY PERFORM THESE TESTS IF YOU HAVE THE MAGIC PRIVATE KEY.
if (process.env.MAGIC_PRIVATE_KEY !== undefined) {
    const devnetOwner = Keypair.fromSecretKey(
        Buffer.from(process.env.MAGIC_PRIVATE_KEY!, "base64"),
    );

    describe("Token Router", function () {
        const connection = new Connection(LOCALHOST, "processed");
        const payer = PAYER_KEYPAIR;

        const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(
            connection,
            matchingEngineSdk.testnet(),
            USDC_MINT_ADDRESS,
        );
        const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
            connection,
            tokenRouterSdk.testnet(),
            matchingEngine.mint,
        );
        const upgradeManager = new UpgradeManagerProgram(connection, testnet());

        describe("Set Up Environment", function () {
            // TODO: remove
            it.skip("Upgrade Matching Engine to Current Implementation (REMOVE ME)", async function () {
                console.log("It'sa me!", devnetOwner.publicKey.toString());

                const buffer = loadProgramBpf(MATCHING_ENGINE_ARTIFACT_PATH);

                const setBufferAuthorityIx = new TransactionInstruction({
                    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                    keys: [
                        {
                            pubkey: buffer,
                            isWritable: true,
                            isSigner: false,
                        },
                        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
                        { pubkey: devnetOwner.publicKey, isSigner: false, isWritable: false },
                    ],
                    data: Buffer.from([4, 0, 0, 0]),
                });

                const upgradeIx = new TransactionInstruction({
                    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                    keys: [
                        {
                            pubkey: programDataAddress(matchingEngine.ID),
                            isWritable: true,
                            isSigner: false,
                        },
                        { pubkey: matchingEngine.ID, isWritable: true, isSigner: false },
                        { pubkey: buffer, isWritable: true, isSigner: false },
                        { pubkey: payer.publicKey, isWritable: true, isSigner: false },
                        { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
                        { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
                        { pubkey: devnetOwner.publicKey, isWritable: false, isSigner: true },
                    ],
                    data: Buffer.from([3, 0, 0, 0]),
                });

                const transferIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: devnetOwner.publicKey,
                    lamports: 1_000_000_000,
                });

                await expectIxOk(
                    connection,
                    [transferIx, setBufferAuthorityIx, upgradeIx],
                    [payer, devnetOwner],
                );
            });

            // TODO: remove
            it.skip("Upgrade Token Router to Current Implementation (REMOVE ME)", async function () {
                console.log("It'sa me!", devnetOwner.publicKey.toString());

                const buffer = loadProgramBpf(TOKEN_ROUTER_ARTIFACT_PATH);

                const setBufferAuthorityIx = new TransactionInstruction({
                    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                    keys: [
                        {
                            pubkey: buffer,
                            isWritable: true,
                            isSigner: false,
                        },
                        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
                        { pubkey: devnetOwner.publicKey, isSigner: false, isWritable: false },
                    ],
                    data: Buffer.from([4, 0, 0, 0]),
                });

                const upgradeIx = new TransactionInstruction({
                    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
                    keys: [
                        {
                            pubkey: programDataAddress(tokenRouter.ID),
                            isWritable: true,
                            isSigner: false,
                        },
                        { pubkey: tokenRouter.ID, isWritable: true, isSigner: false },
                        { pubkey: buffer, isWritable: true, isSigner: false },
                        { pubkey: payer.publicKey, isWritable: true, isSigner: false },
                        { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false },
                        { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
                        { pubkey: devnetOwner.publicKey, isWritable: false, isSigner: true },
                    ],
                    data: Buffer.from([3, 0, 0, 0]),
                });

                const transferIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: devnetOwner.publicKey,
                    lamports: 1_000_000_000,
                });

                await expectIxOk(
                    connection,
                    [transferIx, setBufferAuthorityIx, upgradeIx],
                    [payer, devnetOwner],
                );
            });

            // TODO: remove
            it("Set Authority of Forked Matching Engine to Upgrade Manager (REMOVE ME)", async function () {
                console.log("It'sa me!", devnetOwner.publicKey.toString());

                const ix = setUpgradeAuthorityIx(
                    matchingEngine.ID,
                    devnetOwner.publicKey,
                    upgradeManager.upgradeAuthorityAddress(),
                );

                await expectIxOk(connection, [ix], [payer, devnetOwner]);
            });

            // TODO: remove
            it("Set Authority of Forked Token Router to Upgrade Manager (REMOVE ME)", async function () {
                console.log("It'sa me!", devnetOwner.publicKey.toString());

                const ix = setUpgradeAuthorityIx(
                    tokenRouter.ID,
                    devnetOwner.publicKey,
                    upgradeManager.upgradeAuthorityAddress(),
                );

                await expectIxOk(connection, [ix], [payer, devnetOwner]);
            });
        });

        describe.skip("Upgrade Matching Engine", function () {
            it("Upgrade without Upgrade Ticket", async function () {
                const buffer = loadProgramBpf(MATCHING_ENGINE_ARTIFACT_PATH);

                const ix = await upgradeManager.upgradeMatchingEngineIx({
                    owner: payer.publicKey,
                    matchingEngineBuffer: buffer,
                });
                await expectIxOk(connection, [ix], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it("Upgrade with Upgrade Ticket and with Bad Implementation", async function () {
                const buffer = loadProgramBpf(TOKEN_ROUTER_ARTIFACT_PATH);

                const initializeIx = await matchingEngine.initializeUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });
                const upgradeIx = await upgradeManager.upgradeMatchingEngineIx({
                    owner: payer.publicKey,
                    matchingEngineBuffer: buffer,
                });

                await expectIxOk(connection, [initializeIx, upgradeIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it.skip("Cannot Complete Upgrade with Bad Implementation", async function () {
                // TODO
            });

            it("Fix Upgrade", async function () {
                const buffer = loadProgramBpf(MATCHING_ENGINE_ARTIFACT_PATH);

                const fixIx = await matchingEngine.fixUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });
                const upgradeIx = await upgradeManager.upgradeTokenRouterIx({
                    owner: payer.publicKey,
                    tokenRouterBuffer: buffer,
                });

                await expectIxOk(connection, [fixIx, upgradeIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it("Complete Upgrade", async function () {
                const { buffer } = await matchingEngine.fetchUpgradeTicket();

                const completeIx = await matchingEngine.completeUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });

                await expectIxOk(connection, [completeIx], [payer]);
            });
        });

        describe("Upgrade Token Router", function () {
            it("Execute", async function () {
                const tokenRouterBuffer = loadProgramBpf(TOKEN_ROUTER_ARTIFACT_PATH);

                const ix = await upgradeManager.executeTokenRouterUpgradeIx({
                    owner: payer.publicKey,
                    tokenRouterBuffer,
                });

                await expectIxOk(connection, [ix], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it.skip("Upgrade with Upgrade Ticket and with Bad Implementation", async function () {
                const buffer = loadProgramBpf(MATCHING_ENGINE_ARTIFACT_PATH);

                const authorizeIx = await upgradeManager.authorizeTokenRouterUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });
                const upgradeIx = await upgradeManager.upgradeTokenRouterIx({
                    owner: payer.publicKey,
                    tokenRouterBuffer: buffer,
                });
                console.log("whoa buddy", Array.from(upgradeIx.data.subarray(0, 8)));

                await expectIxOk(connection, [authorizeIx, upgradeIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it.skip("Cannot Complete Upgrade with Bad Implementation", async function () {
                // TODO
            });

            it.skip("Fix Upgrade", async function () {
                const buffer = loadProgramBpf(TOKEN_ROUTER_ARTIFACT_PATH);

                const fixIx = await tokenRouter.fixUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });
                const upgradeIx = await upgradeManager.upgradeTokenRouterIx({
                    owner: payer.publicKey,
                    tokenRouterBuffer: buffer,
                });

                await expectIxOk(connection, [fixIx, upgradeIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });
            });

            it.skip("Complete Upgrade", async function () {
                const { buffer } = await tokenRouter.fetchUpgradeTicket();

                const completeIx = await tokenRouter.completeUpgradeIx({
                    owner: payer.publicKey,
                    buffer,
                });

                await expectIxOk(connection, [completeIx], [payer]);
            });
        });
    });
}

function setUpgradeAuthorityIx(
    programId: PublicKey,
    currentAuthority: PublicKey,
    newAuthority: PublicKey,
) {
    return new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        keys: [
            {
                pubkey: programDataAddress(programId),
                isWritable: true,
                isSigner: false,
            },
            { pubkey: currentAuthority, isSigner: true, isWritable: false },
            { pubkey: newAuthority, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([4, 0, 0, 0]),
    });
}
