import * as wormholeSdk from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    CctpTokenBurnMessage,
    Custodian,
    Fill,
    LiquidityLayerDeposit,
    RouterEndpoint,
    TokenRouterProgram,
} from "../src";
import {
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    postDepositVaa,
} from "./helpers";

chaiUse(chaiAsPromised);

describe("Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    const ownerAssistant = Keypair.generate();

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const invalidChain = (foreignChain + 1) as wormholeSdk.ChainId;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const foreignCctpDomain = 0;
    const unregisteredContractAddress = Buffer.alloc(32, "deafbeef", "hex");
    const tokenRouter = new TokenRouterProgram(connection);

    let lookupTableAddress: PublicKey;

    describe("Admin", function () {
        describe("Initialize", function () {
            const createInitializeIx = (opts?: { ownerAssistant?: PublicKey; mint?: PublicKey }) =>
                tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: opts?.ownerAssistant ?? ownerAssistant.publicKey,
                    mint: opts?.mint ?? USDC_MINT_ADDRESS,
                });

            it.skip("Cannot Initialize Without USDC Mint", async function () {
                // TODO
            });

            it("Cannot Initialize With Default Owner Assistant", async function () {
                await expectIxErr(
                    connection,
                    [await createInitializeIx({ ownerAssistant: PublicKey.default })],
                    [payer],
                    "AssistantZeroPubkey"
                );
            });

            it("Finally Initialize Program", async function () {
                await expectIxOk(connection, [await createInitializeIx()], [payer]);

                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                const expectedCustodianData: Custodian = {
                    bump: 253,
                    custodyTokenBump: 254,
                    paused: false,
                    owner: payer.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    pausedSetBy: payer.publicKey,
                };
                expect(custodianData).to.eql(expectedCustodianData);

                const custodyToken = await splToken.getAccount(
                    connection,
                    tokenRouter.custodyTokenAccountAddress()
                );
                expect(custodyToken.amount).to.equal(0n);
            });

            it("Cannot Call Instruction Again: initialize", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createInitializeIx({
                            ownerAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer],
                    "already in use"
                );
            });

            after("Setup Lookup Table", async () => {
                // Create.
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    })
                );
                await expectIxOk(connection, [createIx], [payer]);

                const usdcCommonAccounts = tokenRouter.commonAccounts(USDC_MINT_ADDRESS);

                // Extend.
                const extendIx = AddressLookupTableProgram.extendLookupTable({
                    payer: payer.publicKey,
                    authority: payer.publicKey,
                    lookupTable,
                    addresses: Object.values(usdcCommonAccounts).filter((key) => key !== undefined),
                });

                await expectIxOk(connection, [extendIx], [payer], {
                    confirmOptions: { commitment: "finalized" },
                });

                lookupTableAddress = lookupTable;
            });
        });

        describe("Ownership Transfer Request", async function () {
            // Create the submit ownership transfer instruction, which will be used
            // to set the pending owner to the `relayer` key.
            const createSubmitOwnershipTransferIx = (opts?: {
                sender?: PublicKey;
                newOwner?: PublicKey;
            }) =>
                tokenRouter.submitOwnershipTransferIx({
                    owner: opts?.sender ?? owner.publicKey,
                    newOwner: opts?.newOwner ?? relayer.publicKey,
                });

            // Create the confirm ownership transfer instruction, which will be used
            // to set the new owner to the `relayer` key.
            const createConfirmOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                tokenRouter.confirmOwnershipTransferIx({
                    pendingOwner: opts?.sender ?? relayer.publicKey,
                });

            // Instruction to cancel an ownership transfer request.
            const createCancelOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                tokenRouter.cancelOwnershipTransferIx({
                    owner: opts?.sender ?? owner.publicKey,
                });

            it("Submit Ownership Transfer Request as Deployer (Payer)", async function () {
                await expectIxOk(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: payer.publicKey,
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer]
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );

                expect(custodianData.pendingOwner).deep.equals(owner.publicKey);
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner]
                );

                // Confirm that the owner config reflects the current ownership status.
                {
                    const custodianData = await tokenRouter.fetchCustodian(
                        tokenRouter.custodianAddress()
                    );
                    expect(custodianData.owner).deep.equals(owner.publicKey);
                    expect(custodianData.pendingOwner).deep.equals(null);
                }
            });

            it("Cannot Submit Ownership Transfer Request (New Owner == Address(0))", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            newOwner: PublicKey.default,
                        }),
                    ],
                    [payer, owner],
                    "InvalidNewOwner"
                );
            });

            it("Cannot Submit Ownership Transfer Request (New Owner == Owner)", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer, owner],
                    "AlreadyOwner"
                );
            });

            it("Cannot Submit Ownership Transfer Request as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, ownerAssistant],
                    "OwnerOnly"
                );
            });

            it("Submit Ownership Transfer Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner]
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(custodianData.pendingOwner).deep.equals(relayer.publicKey);
            });

            it("Cannot Confirm Ownership Transfer Request as Non Pending Owner", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createConfirmOwnershipTransferIx({
                            sender: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, ownerAssistant],
                    "NotPendingOwner"
                );
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx()],
                    [payer, relayer]
                );

                // Confirm that the owner config reflects the current ownership status.
                {
                    const custodianData = await tokenRouter.fetchCustodian(
                        tokenRouter.custodianAddress()
                    );
                    expect(custodianData.owner).deep.equals(relayer.publicKey);
                    expect(custodianData.pendingOwner).deep.equals(null);
                }

                // Set the owner back to the payer key.
                await expectIxOk(
                    connection,
                    [
                        await createSubmitOwnershipTransferIx({
                            sender: relayer.publicKey,
                            newOwner: owner.publicKey,
                        }),
                    ],
                    [payer, relayer]
                );

                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner]
                );

                // Confirm that the payer is the owner again.
                {
                    const custodianData = await tokenRouter.fetchCustodian(
                        tokenRouter.custodianAddress()
                    );
                    expect(custodianData.owner).deep.equals(owner.publicKey);
                    expect(custodianData.pendingOwner).deep.equals(null);
                }
            });

            it("Cannot Cancel Ownership Request as Non-Owner", async function () {
                // First, submit the ownership transfer request.
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner]
                );

                // Confirm that the pending owner variable is set in the owner config.
                {
                    const custodianData = await tokenRouter.fetchCustodian(
                        tokenRouter.custodianAddress()
                    );
                    expect(custodianData.pendingOwner).deep.equals(relayer.publicKey);
                }

                // Confirm that the cancel ownership transfer request fails.
                await expectIxErr(
                    connection,
                    [await createCancelOwnershipTransferIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly"
                );
            });

            it("Cancel Ownership Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createCancelOwnershipTransferIx()],
                    [payer, owner]
                );

                // Confirm the pending owner field was reset.
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(custodianData.pendingOwner).deep.equals(null);
            });
        });

        describe("Update Owner Assistant", async function () {
            // Create the update owner assistant instruction.
            const createUpdateOwnerAssistantIx = (opts?: {
                sender?: PublicKey;
                newAssistant?: PublicKey;
            }) =>
                tokenRouter.updateOwnerAssistantIx({
                    owner: opts?.sender ?? owner.publicKey,
                    newOwnerAssistant: opts?.newAssistant ?? relayer.publicKey,
                });

            it("Cannot Update Assistant (New Assistant == Address(0))", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateOwnerAssistantIx({ newAssistant: PublicKey.default })],
                    [payer, owner],
                    "InvalidNewAssistant"
                );
            });

            it("Cannot Update Assistant as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateOwnerAssistantIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly"
                );
            });

            it("Update Assistant as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createUpdateOwnerAssistantIx()],
                    [payer, owner]
                );

                // Confirm the assistant field was updated.
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(custodianData.ownerAssistant).deep.equals(relayer.publicKey);

                // Set the assistant back to the assistant key.
                await expectIxOk(
                    connection,
                    [
                        await createUpdateOwnerAssistantIx({
                            newAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, owner]
                );
            });
        });

        describe("Add Router Endpoint", function () {
            const createAddRouterEndpointIx = (opts?: {
                sender?: PublicKey;
                contractAddress?: Array<number>;
                cctpDomain?: number | null;
            }) =>
                tokenRouter.addRouterEndpointIx(
                    {
                        ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: opts?.contractAddress ?? routerEndpointAddress,
                        cctpDomain: opts?.cctpDomain ?? foreignCctpDomain,
                    }
                );

            before("Transfer Lamports to Owner and Owner Assistant", async function () {
                await expectIxOk(
                    connection,
                    [
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: owner.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: ownerAssistant.publicKey,
                            lamports: 1000000000,
                        }),
                    ],
                    [payer]
                );
            });

            it("Cannot Add Router Endpoint as Non-Owner and Non-Assistant", async function () {
                await expectIxErr(
                    connection,
                    [await createAddRouterEndpointIx({ sender: payer.publicKey })],
                    [payer],
                    "OwnerOrAssistantOnly"
                );
            });

            [wormholeSdk.CHAINS.unset, wormholeSdk.CHAINS.solana].forEach((chain) =>
                it(`Cannot Register Chain ID == ${chain}`, async function () {
                    await expectIxErr(
                        connection,
                        [
                            await tokenRouter.addRouterEndpointIx(
                                { ownerOrAssistant: owner.publicKey },
                                { chain, address: routerEndpointAddress, cctpDomain: null }
                            ),
                        ],
                        [owner],
                        "ChainNotAllowed"
                    );
                })
            );

            it("Cannot Register Zero Address", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createAddRouterEndpointIx({
                            contractAddress: new Array(32).fill(0),
                        }),
                    ],
                    [owner],
                    "InvalidEndpoint"
                );
            });

            it(`Add Router Endpoint as Owner Assistant`, async function () {
                const contractAddress = Array.from(Buffer.alloc(32, "fbadc0de", "hex"));
                await expectIxOk(
                    connection,
                    [
                        await createAddRouterEndpointIx({
                            sender: ownerAssistant.publicKey,
                            contractAddress,
                        }),
                    ],
                    [ownerAssistant]
                );

                const routerEndpointData = await tokenRouter.fetchRouterEndpoint(
                    tokenRouter.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData: RouterEndpoint = {
                    bump: 255,
                    chain: foreignChain,
                    address: contractAddress,
                    cctpDomain: foreignCctpDomain,
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });

            it(`Update Router Endpoint as Owner`, async function () {
                await expectIxOk(
                    connection,
                    [
                        await createAddRouterEndpointIx({
                            contractAddress: routerEndpointAddress,
                        }),
                    ],
                    [owner]
                );

                const routerEndpointData = await tokenRouter.fetchRouterEndpoint(
                    tokenRouter.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData: RouterEndpoint = {
                    bump: 255,
                    chain: foreignChain,
                    address: routerEndpointAddress,
                    cctpDomain: foreignCctpDomain,
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });
        });

        describe("Set Pause", async function () {
            const createSetPauseIx = (opts?: { sender?: PublicKey; paused?: boolean }) =>
                tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    },
                    opts?.paused ?? true
                );

            it("Cannot Set Pause for Transfers as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [await createSetPauseIx({ sender: payer.publicKey })],
                    [payer],
                    "OwnerOrAssistantOnly"
                );
            });

            it("Set Paused == true as Owner Assistant", async function () {
                const paused = true;
                await expectIxOk(
                    connection,
                    [await createSetPauseIx({ sender: ownerAssistant.publicKey, paused })],
                    [ownerAssistant]
                );

                const [actualPaused, pausedSetBy] = await tokenRouter
                    .fetchCustodian(tokenRouter.custodianAddress())
                    .then((data) => [data.paused, data.pausedSetBy]);
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(ownerAssistant.publicKey);
            });

            it("Set Paused == false as Owner", async function () {
                const paused = false;
                await expectIxOk(connection, [await createSetPauseIx({ paused })], [owner]);

                const [actualPaused, pausedSetBy] = await tokenRouter
                    .fetchCustodian(tokenRouter.custodianAddress())
                    .then((data) => [data.paused, data.pausedSetBy]);
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(owner.publicKey);
            });
        });
    });

    describe("Place Market Order (CCTP)", () => {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        const createPlaceMarketOrderCctpIx = (
            amountIn: bigint,
            opts?: {
                sender?: PublicKey;
                mint?: PublicKey;
                burnSource?: PublicKey;
                burnSourceAuthority?: PublicKey;
                targetChain?: wormholeSdk.ChainId;
                redeemer?: Array<number>;
            }
        ) =>
            tokenRouter.placeMarketOrderCctpIx(
                {
                    payer: opts?.sender ?? payer.publicKey,
                    mint: opts?.mint ?? USDC_MINT_ADDRESS,
                    burnSource: opts?.burnSource ?? payerToken,
                    burnSourceAuthority: opts?.burnSourceAuthority ?? payer.publicKey,
                },
                {
                    amountIn,
                    targetChain: opts?.targetChain ?? foreignChain,
                    redeemer: opts?.redeemer ?? Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                }
            );

        it.skip("Cannot Place Market Order with Insufficient Amount", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Invalid Redeemer", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Unregistered Endpoint", async function () {
            // TODO
        });

        it("Cannot Place Market Order as Invalid Burn Source Authority", async function () {
            const burnSourceAuthority = Keypair.generate();

            const amountIn = 69n;

            // TODO: use lookup table
            // NOTE: This error comes from the SPL Token program.
            await expectIxErr(
                connection,
                [
                    await createPlaceMarketOrderCctpIx(amountIn, {
                        burnSourceAuthority: burnSourceAuthority.publicKey,
                    }),
                ],
                [payer, burnSourceAuthority],
                "Error: owner does not match"
            );
        });

        it("Place Market Order as Burn Source Authority", async function () {
            const burnSourceAuthority = Keypair.generate();
            const burnSource = await splToken.createAccount(
                connection,
                payer,
                USDC_MINT_ADDRESS,
                burnSourceAuthority.publicKey
            );

            const amountIn = 69n;

            // Add funds to account.
            await splToken.mintTo(
                connection,
                payer,
                USDC_MINT_ADDRESS,
                burnSource,
                payer,
                amountIn
            );

            const { amount: balanceBefore } = await splToken.getAccount(connection, burnSource);

            // TODO: use lookup table
            await expectIxOk(
                connection,
                [
                    await createPlaceMarketOrderCctpIx(amountIn, {
                        burnSource,
                        burnSourceAuthority: burnSourceAuthority.publicKey,
                    }),
                ],
                [payer, burnSourceAuthority]
            );

            const { amount: balanceAfter } = await splToken.getAccount(connection, burnSource);
            expect(balanceAfter + amountIn).equals(balanceBefore);

            // TODO: check message
        });

        it("Place Market Order as Payer", async function () {
            const amountIn = 69n;

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

            // TODO: use lookup table
            await expectIxOk(connection, [await createPlaceMarketOrderCctpIx(amountIn)], [payer]);

            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter + amountIn).equals(balanceBefore);

            // TODO: check message
        });
    });

    describe("Redeem Fill (CCTP)", () => {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        let testCctpNonce = 2n ** 64n - 1n;

        // Hack to prevent math overflow error when invoking CCTP programs.
        testCctpNonce -= 2n * 6400n;

        let wormholeSequence = 0n;

        const localVariables = new Map<string, any>();

        const createRedeemFillCctpIx = (
            vaa: PublicKey,
            encodedCctpMessage: Buffer,
            opts?: {
                sender?: PublicKey;
                redeemer?: PublicKey;
                dstToken?: PublicKey;
                cctpAttestation?: Buffer;
            }
        ) =>
            tokenRouter.redeemFillCctpIx(
                {
                    payer: opts?.sender ?? payer.publicKey,
                    vaa,
                    redeemer: opts?.redeemer ?? payer.publicKey,
                    dstToken: opts?.dstToken ?? payerToken,
                },
                {
                    encodedCctpMessage,
                    cctpAttestation:
                        opts?.cctpAttestation ??
                        new CircleAttester().createAttestation(encodedCctpMessage),
                }
            );

        it("Redeem Fill", async function () {
            const redeemer = Keypair.generate();

            const encodedMintRecipient = Array.from(
                tokenRouter.custodyTokenAccountAddress().toBuffer()
            );
            const sourceCctpDomain = 0;
            const cctpNonce = testCctpNonce++;
            const amount = 69n;

            // Concoct a Circle message.
            const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
            const { destinationCctpDomain, burnMessage, encodedCctpMessage } =
                await craftCctpTokenBurnMessage(
                    tokenRouter,
                    sourceCctpDomain,
                    cctpNonce,
                    encodedMintRecipient,
                    amount,
                    burnSource
                );

            const fill: Fill = {
                sourceChain: foreignChain,
                orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                redeemer: Array.from(redeemer.publicKey.toBuffer()),
                redeemerMessage: Buffer.from("Somebody set up us the bomb"),
            };
            const deposit = new LiquidityLayerDeposit(
                {
                    tokenAddress: burnMessage.burnTokenAddress,
                    amount,
                    sourceCctpDomain,
                    destinationCctpDomain,
                    cctpNonce,
                    burnSource,
                    mintRecipient: encodedMintRecipient,
                },
                { fill }
            );

            const vaa = await postDepositVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                routerEndpointAddress,
                wormholeSequence++,
                deposit
            );

            const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: 250_000,
            });

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

            const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                lookupTableAddress
            );
            await expectIxOk(
                connection,
                [
                    computeIx,
                    await createRedeemFillCctpIx(vaa, encodedCctpMessage, {
                        redeemer: redeemer.publicKey,
                    }),
                ],
                [payer, redeemer],
                { addressLookupTableAccounts: [lookupTableAccount!] }
            );

            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter).equals(balanceBefore + amount);

            // TODO: check message
        });
    });
});

async function craftCctpTokenBurnMessage(
    tokenRouter: TokenRouterProgram,
    sourceCctpDomain: number,
    cctpNonce: bigint,
    encodedMintRecipient: number[],
    amount: bigint,
    burnSource: number[],
    overrides: { destinationCctpDomain?: number } = {}
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = tokenRouter.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
        messageTransmitterProgram.messageTransmitterConfigAddress()
    );
    const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

    const tokenMessengerMinterProgram = tokenRouter.tokenMessengerMinterProgram();
    const sourceTokenMessenger = await tokenMessengerMinterProgram
        .fetchRemoteTokenMessenger(
            tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceCctpDomain)
        )
        .then((remote) => remote.tokenMessenger);

    const burnMessage = new CctpTokenBurnMessage(
        {
            version,
            sourceDomain: sourceCctpDomain,
            destinationDomain: destinationCctpDomain,
            nonce: cctpNonce,
            sender: sourceTokenMessenger,
            recipient: Array.from(tokenMessengerMinterProgram.ID.toBuffer()), // targetTokenMessenger
            targetCaller: Array.from(tokenRouter.custodianAddress().toBuffer()), // targetCaller
        },
        0,
        Array.from(wormholeSdk.tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "ethereum")), // sourceTokenAddress
        encodedMintRecipient,
        amount,
        burnSource
    );

    const encodedCctpMessage = burnMessage.encode();

    return {
        destinationCctpDomain,
        burnMessage,
        encodedCctpMessage,
    };
}
