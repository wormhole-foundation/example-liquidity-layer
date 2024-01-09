import { CHAINS, ChainId } from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    AuctionConfig,
    Custodian,
    RouterEndpoint,
    MatchingEngineProgram,
} from "../src/matching_engine";
import { LOCALHOST, PAYER_KEYPAIR, expectIxErr, expectIxOk, USDC_MINT_ADDRESS } from "./helpers";

chaiUse(chaiAsPromised);

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // owner is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const owner = Keypair.generate();
    const relayer = Keypair.generate();
    const ownerAssistant = Keypair.generate();
    const feeRecipient = Keypair.generate();
    const newFeeRecipient = Keypair.generate();

    const foreignChain = CHAINS.ethereum;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const engine = new MatchingEngineProgram(connection);

    describe("Admin", function () {
        describe("Initialize", function () {
            const auctionConfig: AuctionConfig = {
                userPenaltyRewardBps: 250000,
                initialPenaltyBps: 250000,
                auctionDuration: 10,
                auctionGracePeriod: 30,
                auctionPenaltyBlocks: 60,
            };

            const createInitializeIx = (opts?: {
                ownerAssistant?: PublicKey;
                feeRecipient?: PublicKey;
                mint?: PublicKey;
            }) =>
                engine.initializeIx(auctionConfig, {
                    owner: payer.publicKey,
                    ownerAssistant: opts?.ownerAssistant ?? ownerAssistant.publicKey,
                    feeRecipient: opts?.feeRecipient ?? feeRecipient.publicKey,
                    mint: opts?.mint ?? USDC_MINT_ADDRESS,
                });

            it("Cannot Initialize With Default Owner Assistant", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createInitializeIx({
                            ownerAssistant: PublicKey.default,
                        }),
                    ],
                    [payer],
                    "AssistantZeroPubkey"
                );
            });

            it("Cannot Initialize With Default Fee Recipient", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createInitializeIx({
                            feeRecipient: PublicKey.default,
                        }),
                    ],
                    [payer],
                    "FeeRecipientZeroPubkey"
                );
            });

            it("Cannot Initialize With Invalid Auction Duration", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.auctionDuration = 0;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                            mint: USDC_MINT_ADDRESS,
                        }),
                    ],
                    [payer],
                    "InvalidAuctionDuration"
                );
            });

            it("Cannot Initialize With Invalid Auction Grace Period", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.auctionGracePeriod = auctionConfig.auctionDuration - 1;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                            mint: USDC_MINT_ADDRESS,
                        }),
                    ],
                    [payer],
                    "InvalidAuctionGracePeriod"
                );
            });

            it("Cannot Initialize With Invalid User Penalty", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.userPenaltyRewardBps = 4294967295;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                            mint: USDC_MINT_ADDRESS,
                        }),
                    ],
                    [payer],
                    "UserPenaltyTooLarge"
                );
            });

            it("Cannot Initialize With Invalid Initial Penalty", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.initialPenaltyBps = 4294967295;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                            mint: USDC_MINT_ADDRESS,
                        }),
                    ],
                    [payer],
                    "InitialPenaltyTooLarge"
                );
            });

            it("Finally Initialize Program", async function () {
                await expectIxOk(connection, [await createInitializeIx()], [payer]);

                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
                const expectedCustodianData = {
                    bump: 255,
                    custodyTokenBump: 254,
                    owner: payer.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    feeRecipient: feeRecipient.publicKey,
                    auctionConfig: auctionConfig,
                } as Custodian;
                expect(custodianData).to.eql(expectedCustodianData);
            });

            it("Cannot Call Instruction Again: initialize", async function () {
                await expectIxErr(
                    connection,
                    [await createInitializeIx({})],
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
                engine.submitOwnershipTransferIx({
                    owner: opts?.sender ?? owner.publicKey,
                    newOwner: opts?.newOwner ?? relayer.publicKey,
                });

            // Create the confirm ownership transfer instruction, which will be used
            // to set the new owner to the `relayer` key.
            const createConfirmOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                engine.confirmOwnershipTransferIx({
                    pendingOwner: opts?.sender ?? relayer.publicKey,
                });

            // Instruction to cancel an ownership transfer request.
            const createCancelOwnershipTransferIx = (opts?: { sender?: PublicKey }) =>
                engine.cancelOwnershipTransferIx({
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
                const custodianData = await engine.fetchCustodian(engine.custodianAddress());

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
                    const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
                    const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
                    const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
                    const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
                expect(custodianData.pendingOwner).deep.equals(null);
            });
        });

        describe("Update Owner Assistant", async function () {
            // Create the update owner assistant instruction.
            const createUpdateOwnerAssistantIx = (opts?: {
                sender?: PublicKey;
                newAssistant?: PublicKey;
            }) =>
                engine.updateOwnerAssistantIx({
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
                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
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
            }) =>
                engine.addRouterEndpointIx(
                    {
                        ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: opts?.contractAddress ?? routerEndpointAddress,
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

            it("Cannot Register Chain ID ==  0", async function () {
                const chain = 0;

                await expectIxErr(
                    connection,
                    [
                        await engine.addRouterEndpointIx(
                            { ownerOrAssistant: owner.publicKey },
                            { chain, address: routerEndpointAddress }
                        ),
                    ],
                    [owner],
                    "ChainNotAllowed"
                );
            });

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

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: contractAddress,
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

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: routerEndpointAddress,
                } as RouterEndpoint;
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });
        });

        describe("Update Fee Recipient", async function () {
            const createUpdateFeeRecipientIx = (opts?: {
                sender?: PublicKey;
                newFeeRecipient?: PublicKey;
            }) =>
                engine.updateFeeRecipientIx({
                    ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    newFeeRecipient: opts?.newFeeRecipient ?? newFeeRecipient.publicKey,
                });

            it("Cannot Update Fee Recipient as Non-Owner and Non-Assistant", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateFeeRecipientIx({ sender: payer.publicKey })],
                    [payer],
                    "OwnerOrAssistantOnly"
                );
            });

            it("Cannot Update Fee Recipient to Address(0)", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateFeeRecipientIx({ newFeeRecipient: PublicKey.default })],
                    [owner],
                    "FeeRecipientZeroPubkey"
                );
            });

            it("Update Fee Recipient as Owner Assistant", async function () {
                await expectIxOk(
                    connection,
                    [await createUpdateFeeRecipientIx({ sender: ownerAssistant.publicKey })],
                    [ownerAssistant]
                );

                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
                expect(custodianData.feeRecipient).deep.equals(newFeeRecipient.publicKey);
            });
        });
    });
});
