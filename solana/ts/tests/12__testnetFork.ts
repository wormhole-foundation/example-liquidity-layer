import { Connection, Keypair, PublicKey, Signer, TransactionInstruction } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";
import { testnet, UpgradeManagerProgram } from "../src/upgradeManager";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, programDataAddress } from "../src/utils";
import {
    bigintToU64BN,
    expectIxErr,
    expectIxOk,
    expectIxOkDetails,
    loadProgramBpf,
    LOCALHOST,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
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

    describe("Upgrade Manager", function () {
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
            it("Set Authority of Forked Programs to Upgrade Manager (REMOVE ME)", async function () {
                console.log("It'sa me!", devnetOwner.publicKey.toString());

                await expectIxOk(
                    connection,
                    [
                        setUpgradeAuthorityIx({
                            programId: matchingEngine.ID,
                            currentAuthority: devnetOwner.publicKey,
                            newAuthority: upgradeManager.upgradeAuthorityAddress(),
                        }),
                        setUpgradeAuthorityIx({
                            programId: tokenRouter.ID,
                            currentAuthority: devnetOwner.publicKey,
                            newAuthority: upgradeManager.upgradeAuthorityAddress(),
                        }),
                    ],
                    [payer, devnetOwner],
                );
            });
        });

        describe("Upgrade Matching Engine", function () {
            it("Execute", async function () {
                await executeMatchingEngineUpgrade({
                    owner: payer.publicKey,
                });
            });

            it("Execute Another Upgrade Before Commit", async function () {
                await executeMatchingEngineUpgrade({
                    owner: payer.publicKey,
                });
            });

            it("Commit After Execute (Recipient != Owner)", async function () {
                await commitMatchingEngineUpgradeForTest(
                    {
                        owner: payer.publicKey,
                        recipient: Keypair.generate().publicKey,
                    },
                    {
                        upgrade: false,
                    },
                );
            });

            it("Execute and Commit Upgrade After Commit", async function () {
                await commitMatchingEngineUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            it("Cannot Commit after Execute Upgrade to Bad Implementation", async function () {
                await commitMatchingEngineUpgradeForTest(
                    {
                        owner: payer.publicKey,
                    },
                    {
                        artifactPath: TOKEN_ROUTER_ARTIFACT_PATH,
                        errorMsg: "Error Code: DeclaredProgramIdMismatch",
                    },
                );
            });

            it("Execute and Commit Upgrade Again", async function () {
                await commitMatchingEngineUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            async function executeMatchingEngineUpgrade(
                accounts: {
                    owner: PublicKey;
                    payer?: PublicKey;
                },
                args: {
                    artifactPath?: string;
                    errorMsg?: string | null;
                    signer?: Signer;
                } = {},
            ) {
                let { artifactPath, signer, errorMsg } = args;
                artifactPath ??= MATCHING_ENGINE_ARTIFACT_PATH;
                signer ??= payer;
                errorMsg ??= null;

                const matchingEngineBuffer = loadProgramBpf(artifactPath);

                const ix = await upgradeManager.executeMatchingEngineUpgradeIx({
                    matchingEngineBuffer,
                    ...accounts,
                });

                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], [signer], errorMsg);
                }

                const txDetails = await expectIxOkDetails(connection, [ix], [signer], {
                    confirmOptions: { commitment: "finalized" },
                });

                const upgradeReceiptData = await upgradeManager.fetchUpgradeReceipt(
                    matchingEngine.ID,
                );
                const { bump, programDataBump } = upgradeReceiptData;
                expect(upgradeReceiptData).to.eql({
                    bump,
                    programDataBump,
                    status: {
                        uncommitted: {
                            buffer: matchingEngineBuffer,
                            slot: bigintToU64BN(BigInt(txDetails!.slot)),
                        },
                    },
                });

                const { owner } = await matchingEngine.fetchCustodian();
                expect(owner.equals(upgradeManager.upgradeAuthorityAddress())).is.true;

                return { matchingEngineBuffer };
            }

            async function commitMatchingEngineUpgradeForTest(
                accounts: {
                    owner: PublicKey;
                    recipient?: PublicKey;
                },
                args: {
                    upgrade?: boolean;
                    artifactPath?: string;
                    errorMsg?: string | null;
                    signer?: Signer;
                } = {},
            ) {
                let { upgrade, artifactPath, signer, errorMsg } = args;
                upgrade ??= true;
                artifactPath ??= MATCHING_ENGINE_ARTIFACT_PATH;
                signer ??= payer;
                errorMsg ??= null;

                if (upgrade) {
                    await executeMatchingEngineUpgrade(
                        {
                            owner: accounts.owner,
                        },
                        {
                            artifactPath,
                        },
                    );
                }

                const recipientBalanceBefore = await (async () => {
                    const { owner, recipient } = accounts;
                    if (recipient !== undefined && !recipient.equals(owner)) {
                        return connection.getBalance(recipient);
                    } else {
                        return null;
                    }
                })();

                const upgradeReceipt = upgradeManager.upgradeReceiptAddress(matchingEngine.ID);
                const upgradeReceiptInfoBefore = await connection.getAccountInfo(upgradeReceipt);
                expect(upgradeReceiptInfoBefore).is.not.null;

                const upgradeReceiptLamports = upgradeReceiptInfoBefore!.lamports;

                const ix = await upgradeManager.commitMatchingEngineUpgradeIx(accounts);
                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], [signer], errorMsg);
                }

                await expectIxOk(connection, [ix], [signer]);

                const upgradeReceiptInfo = await connection.getAccountInfo(
                    upgradeManager.upgradeReceiptAddress(tokenRouter.ID),
                );
                expect(upgradeReceiptInfo).is.null;

                // Only check if this isn't null.
                if (recipientBalanceBefore !== null) {
                    const recipientBalanceAfter = await connection.getBalance(accounts.recipient!);
                    expect(recipientBalanceAfter).to.eql(
                        recipientBalanceBefore + upgradeReceiptLamports,
                    );
                }

                const { owner } = await matchingEngine.fetchCustodian();
                expect(owner.equals(accounts.owner)).is.true;
            }
        });

        describe("Upgrade Token Router", function () {
            it("Execute", async function () {
                await executeTokenRouterUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            it("Execute Another Upgrade Before Commit", async function () {
                await executeTokenRouterUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            it("Commit After Execute (Recipient != Owner)", async function () {
                await commitTokenRouterUpgradeForTest(
                    {
                        owner: payer.publicKey,
                        recipient: Keypair.generate().publicKey,
                    },
                    {
                        upgrade: false,
                    },
                );
            });

            it("Execute and Commit Upgrade After Commit", async function () {
                await commitTokenRouterUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            it("Cannot Commit after Execute Upgrade to Bad Implementation", async function () {
                await commitTokenRouterUpgradeForTest(
                    {
                        owner: payer.publicKey,
                    },
                    {
                        artifactPath: MATCHING_ENGINE_ARTIFACT_PATH,
                        errorMsg: "Error Code: DeclaredProgramIdMismatch",
                    },
                );
            });

            it("Execute and Commit Upgrade Again", async function () {
                await commitTokenRouterUpgradeForTest({
                    owner: payer.publicKey,
                });
            });

            async function executeTokenRouterUpgradeForTest(
                accounts: {
                    owner: PublicKey;
                    payer?: PublicKey;
                },
                args: {
                    artifactPath?: string;
                    errorMsg?: string | null;
                    signer?: Signer;
                } = {},
            ) {
                let { artifactPath, signer, errorMsg } = args;
                artifactPath ??= TOKEN_ROUTER_ARTIFACT_PATH;
                signer ??= payer;
                errorMsg ??= null;

                const tokenRouterBuffer = loadProgramBpf(artifactPath);

                const ix = await upgradeManager.executeTokenRouterUpgradeIx({
                    tokenRouterBuffer,
                    ...accounts,
                });

                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], [signer], errorMsg);
                }

                const txDetails = await expectIxOkDetails(connection, [ix], [signer], {
                    confirmOptions: { commitment: "finalized" },
                });

                const upgradeReceiptData = await upgradeManager.fetchUpgradeReceipt(tokenRouter.ID);
                const { bump, programDataBump } = upgradeReceiptData;
                expect(upgradeReceiptData).to.eql({
                    bump,
                    programDataBump,
                    status: {
                        uncommitted: {
                            buffer: tokenRouterBuffer,
                            slot: bigintToU64BN(BigInt(txDetails!.slot)),
                        },
                    },
                });

                const { owner } = await tokenRouter.fetchCustodian();
                expect(owner.equals(upgradeManager.upgradeAuthorityAddress())).is.true;

                return { tokenRouterBuffer };
            }

            async function commitTokenRouterUpgradeForTest(
                accounts: {
                    owner: PublicKey;
                    recipient?: PublicKey;
                },
                args: {
                    upgrade?: boolean;
                    artifactPath?: string;
                    errorMsg?: string | null;
                    signer?: Signer;
                } = {},
            ) {
                let { upgrade, artifactPath, signer, errorMsg } = args;
                upgrade ??= true;
                artifactPath ??= TOKEN_ROUTER_ARTIFACT_PATH;
                signer ??= payer;
                errorMsg ??= null;

                if (upgrade) {
                    await executeTokenRouterUpgradeForTest(
                        {
                            owner: accounts.owner,
                        },
                        {
                            artifactPath,
                        },
                    );
                }

                const recipientBalanceBefore = await (async () => {
                    const { owner, recipient } = accounts;
                    if (recipient !== undefined && !recipient.equals(owner)) {
                        return connection.getBalance(recipient);
                    } else {
                        return null;
                    }
                })();

                const upgradeReceipt = upgradeManager.upgradeReceiptAddress(tokenRouter.ID);
                const upgradeReceiptInfoBefore = await connection.getAccountInfo(upgradeReceipt);
                expect(upgradeReceiptInfoBefore).is.not.null;

                const upgradeReceiptLamports = upgradeReceiptInfoBefore!.lamports;

                const ix = await upgradeManager.commitTokenRouterUpgradeIx(accounts);
                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], [signer], errorMsg);
                }

                await expectIxOk(connection, [ix], [signer]);

                const upgradeReceiptInfo = await connection.getAccountInfo(
                    upgradeManager.upgradeReceiptAddress(tokenRouter.ID),
                );
                expect(upgradeReceiptInfo).is.null;

                // Only check if this isn't null.
                if (recipientBalanceBefore !== null) {
                    const recipientBalanceAfter = await connection.getBalance(accounts.recipient!);
                    expect(recipientBalanceAfter).to.eql(
                        recipientBalanceBefore + upgradeReceiptLamports,
                    );
                }

                const { owner } = await tokenRouter.fetchCustodian();
                expect(owner.equals(accounts.owner)).is.true;
            }
        });
    });
}

function setUpgradeAuthorityIx(accounts: {
    programId: PublicKey;
    currentAuthority: PublicKey;
    newAuthority: PublicKey;
}) {
    const { programId, currentAuthority, newAuthority } = accounts;
    return setBufferAuthorityIx({
        buffer: programDataAddress(programId),
        currentAuthority,
        newAuthority,
    });
}

function setBufferAuthorityIx(accounts: {
    buffer: PublicKey;
    currentAuthority: PublicKey;
    newAuthority: PublicKey;
}) {
    const { buffer, currentAuthority, newAuthority } = accounts;
    return new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        keys: [
            {
                pubkey: buffer,
                isWritable: true,
                isSigner: false,
            },
            { pubkey: currentAuthority, isSigner: true, isWritable: false },
            { pubkey: newAuthority, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([4, 0, 0, 0]),
    });
}
