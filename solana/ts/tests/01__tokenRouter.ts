import { CHAINS, ChainId } from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Custodian, RouterEndpoint, TokenRouterProgram } from "../src";
import { LOCALHOST, PAYER_KEYPAIR, USDC_MINT_ADDRESS, expectIxErr, expectIxOk } from "./helpers";

chaiUse(chaiAsPromised);

describe("Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    const ownerAssistant = Keypair.generate();

    const foreignChain = CHAINS.ethereum;
    const invalidChain = (foreignChain + 1) as ChainId;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const foreignCctpDomain = 0;
    const unregisteredContractAddress = Buffer.alloc(32, "deafbeef", "hex");
    const tokenRouter = new TokenRouterProgram(connection);

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
                const expectedCustodianData = {
                    bump: 253,
                    custodyTokenBump: 254,
                    paused: false,
                    owner: payer.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    pausedSetBy: payer.publicKey,
                } as Custodian;
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

            [CHAINS.unset, CHAINS.solana].forEach((chain) =>
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
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: contractAddress,
                    cctpDomain: foreignCctpDomain,
                } as RouterEndpoint;
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
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: routerEndpointAddress,
                    cctpDomain: foreignCctpDomain,
                } as RouterEndpoint;
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
                targetChain?: ChainId;
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

        it.skip("Cannot Place Market Order with Zero Amount", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Redeemer as Zero Address", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Unregistered Endpoint", async function () {
            // TODO
        });

        it("Place Market Order as Payer", async function () {
            const amountIn = 69n;

            const balanceBefore = await splToken
                .getAccount(connection, payerToken)
                .then((token) => token.amount);

            // TODO: use lookup table
            await expectIxOk(connection, [await createPlaceMarketOrderCctpIx(amountIn)], [payer]);

            const balanceAfter = await splToken
                .getAccount(connection, payerToken)
                .then((token) => token.amount);
            expect(balanceAfter + amountIn).equals(balanceBefore);

            // TODO: check message
        });

        it.skip("Place Market Order as Another Signer", async function () {
            // TODO
        });
    });
});
