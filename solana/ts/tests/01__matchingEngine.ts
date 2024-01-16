import { CHAINS, ChainId, keccak256, parseVaa } from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    AuctionConfig,
    Custodian,
    MatchingEngineProgram,
    RouterEndpoint,
} from "../src/matchingEngine";
import {
    LOCALHOST,
    MOCK_GUARDIANS,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
} from "./helpers";
import {
    FastMarketOrder,
    getBestOfferTokenAccount,
    getInitialAuctioneerTokenAccount,
    getTokenBalance,
    postFastTransferVaa,
    skip_slots,
} from "./helpers/matching_engine_utils";

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
    const auctioneerOne = Keypair.generate();
    const auctioneerTwo = Keypair.generate();

    // Foreign endpoints.
    const ethChain = CHAINS.ethereum;
    const ethRouter = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const ethDomain = 0;
    const arbChain = CHAINS.arbitrum;
    const arbRouter = Array.from(Buffer.alloc(32, "bead", "hex"));
    const arbDomain = 3;

    // Matching Engine program.
    const engine = new MatchingEngineProgram(connection);

    describe("Admin", function () {
        describe("Initialize", function () {
            const auctionConfig: AuctionConfig = {
                userPenaltyRewardBps: 250000,
                initialPenaltyBps: 250000,
                auctionDuration: 2,
                auctionGracePeriod: 4,
                auctionPenaltySlots: 10,
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

            it("Cannot Initialize Without USDC Mint", async function () {
                const mint = await splToken.createMint(connection, payer, payer.publicKey, null, 6);

                await expectIxErr(
                    connection,
                    [await createInitializeIx({ mint })],
                    [payer],
                    "NotUsdc"
                );
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
                chain?: ChainId;
                contractAddress?: Array<number>;
            }) =>
                engine.addRouterEndpointIx(
                    {
                        ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    },
                    {
                        chain: ethChain,
                        address: opts?.contractAddress ?? ethRouter,
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
                            { chain, address: ethRouter }
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
                    engine.routerEndpointAddress(ethChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: ethChain,
                    address: contractAddress,
                } as RouterEndpoint;
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });

            it(`Update Router Endpoint as Owner`, async function () {
                await expectIxOk(
                    connection,
                    [
                        await createAddRouterEndpointIx({
                            contractAddress: ethRouter,
                        }),
                    ],
                    [owner]
                );

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(ethChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: ethChain,
                    address: ethRouter,
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

    describe("Business Logic", function () {
        let wormholeSequence = 0n;

        const baseFastOrder: FastMarketOrder = {
            amountIn: 50000000000n,
            minAmountOut: 0n,
            targetChain: arbChain,
            targetDomain: arbDomain,
            redeemer: Buffer.from("deadbeef", "hex"),
            sender: Buffer.from("beefdead", "hex"),
            refundAddress: Buffer.from("deadbeef", "hex"),
            slowSequence: 0n,
            slowEmitter: Buffer.from("beefdead", "hex"),
            maxFee: 10000n,
            initAuctionFee: 100n,
            deadline: 0,
            redeemerMessage: Buffer.from("All your base are belong to us."),
        };

        before("Register To Router Endpoint", async function () {
            await expectIxOk(
                connection,
                [
                    await engine.addRouterEndpointIx(
                        {
                            ownerOrAssistant: owner.publicKey,
                        },
                        {
                            chain: arbChain,
                            address: arbRouter,
                        }
                    ),
                ],
                [owner]
            );
        });

        before("Transfer Lamports to Auctioneers", async function () {
            await expectIxOk(
                connection,
                [
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: auctioneerOne.publicKey,
                        lamports: 1000000000,
                    }),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: auctioneerTwo.publicKey,
                        lamports: 1000000000,
                    }),
                ],
                [payer]
            );
        });

        before("Create ATAs For Auctioneers", async function () {
            for (const wallet of [auctioneerOne, auctioneerTwo]) {
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    wallet,
                    USDC_MINT_ADDRESS,
                    wallet.publicKey
                );

                // Mint USDC.
                const mintAmount = 100000n * 100000000n;
                const destination = await splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    wallet.publicKey
                );

                await expect(
                    splToken.mintTo(
                        connection,
                        payer,
                        USDC_MINT_ADDRESS,
                        destination,
                        payer,
                        mintAmount
                    )
                ).to.be.fulfilled;

                const { amount } = await splToken.getAccount(connection, destination);
                expect(amount).equals(mintAmount);
            }
        });

        describe("Place Initial Offer", function () {
            it("Place Initial Offer", async function () {
                // Fetch the balances before.
                const auctioneerBefore = await getTokenBalance(connection, auctioneerOne.publicKey);
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    auctioneerOne,
                    wormholeSequence++,
                    baseFastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: baseFastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: arbChain,
                    }
                );

                // Validate balance changes.
                const auctioneerAfter = await getTokenBalance(connection, auctioneerOne.publicKey);
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                expect(auctioneerAfter).equals(
                    auctioneerBefore - baseFastOrder.maxFee - baseFastOrder.amountIn
                );
                expect(custodyAfter).equals(
                    custodyBefore + baseFastOrder.maxFee + baseFastOrder.amountIn
                );

                // Confirm the auction data.
                const vaaHash = keccak256(parseVaa(signedVaa).hash);
                const auctionData = await engine.fetchAuctionData(vaaHash);
                const slot = await connection.getSlot();
                const offerToken = await splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    auctioneerOne.publicKey
                );

                expect(auctionData.bump).to.equal(254);
                expect(auctionData.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionData.status).to.eql({ active: {} });
                expect(auctionData.bestOffer).to.eql(offerToken);
                expect(auctionData.initialOffer).to.eql(offerToken);
                expect(auctionData.startSlot.toString()).to.eql(slot.toString());
                expect(auctionData.amount.toString()).to.eql(baseFastOrder.amountIn.toString());
                expect(auctionData.securityDeposit.toString()).to.eql(
                    baseFastOrder.maxFee.toString()
                );
                expect(auctionData.offerPrice.toString()).to.eql(baseFastOrder.maxFee.toString());
            });
        });

        describe("Improve Offer", function () {
            it("Improve Offer With New Auctioneer", async function () {
                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    auctioneerOne,
                    wormholeSequence++,
                    baseFastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: baseFastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: arbChain,
                    }
                );

                const initalAuctioneerBefore = await getTokenBalance(
                    connection,
                    auctioneerOne.publicKey
                );
                const newAuctioneerBefore = await getTokenBalance(
                    connection,
                    auctioneerTwo.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                // New Offer from auctioneerTwo.
                const newOffer = baseFastOrder.maxFee - 100n;
                const vaaHash = keccak256(parseVaa(signedVaa).hash);
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                const bestOfferToken = await getBestOfferTokenAccount(engine, vaaHash);

                await expectIxOk(
                    connection,
                    [
                        await engine.improveOfferIx(newOffer, keccak256(parseVaa(signedVaa).hash), {
                            offerAuthority: auctioneerTwo.publicKey,
                            bestOfferToken,
                        }),
                    ],
                    [auctioneerTwo]
                );

                // Validate balance changes.
                const initalAuctioneerAfter = await getTokenBalance(
                    connection,
                    auctioneerOne.publicKey
                );
                const newAuctioneerAfter = await getTokenBalance(
                    connection,
                    auctioneerTwo.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                expect(newAuctioneerAfter).equals(
                    newAuctioneerBefore - baseFastOrder.maxFee - baseFastOrder.amountIn
                );
                expect(initalAuctioneerAfter).equals(
                    initalAuctioneerBefore + baseFastOrder.maxFee + baseFastOrder.amountIn
                );
                expect(custodyAfter).equals(custodyBefore);

                // Confirm the auction data.
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);
                const newAuctioneerToken = await splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    auctioneerTwo.publicKey
                );
                const initialAuctioneerToken = await splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    auctioneerOne.publicKey
                );

                expect(auctionDataAfter.bump).to.equal(249);
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ active: {} });
                expect(auctionDataAfter.bestOffer).to.eql(newAuctioneerToken);
                expect(auctionDataAfter.initialOffer).to.eql(initialAuctioneerToken);
                expect(auctionDataAfter.startSlot.toString()).to.eql(
                    auctionDataBefore.startSlot.toString()
                );
                expect(auctionDataAfter.amount.toString()).to.eql(
                    auctionDataBefore.amount.toString()
                );
                expect(auctionDataAfter.securityDeposit.toString()).to.eql(
                    auctionDataBefore.securityDeposit.toString()
                );
                expect(auctionDataAfter.offerPrice.toString()).to.eql(newOffer.toString());
            });
        });

        describe("Execute Fast Order Within Grace Period", function () {
            it("Execute Fast Order", async function () {
                // Start the auction with auctioneer two so that we can
                // check that the initial auctioneer is refunded.
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    auctioneerTwo,
                    wormholeSequence++,
                    baseFastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: baseFastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: arbChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = keccak256(parseVaa(signedVaa).hash);
                let bestOfferToken = await getBestOfferTokenAccount(engine, vaaHash);
                const initialOfferToken = await getInitialAuctioneerTokenAccount(engine, vaaHash);
                const newOffer = baseFastOrder.maxFee - 100n;

                // Improve the bid with auctioneer one.
                await expectIxOk(
                    connection,
                    [
                        await engine.improveOfferIx(newOffer, keccak256(parseVaa(signedVaa).hash), {
                            offerAuthority: auctioneerOne.publicKey,
                            bestOfferToken,
                        }),
                    ],
                    [auctioneerOne]
                );

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    auctioneerOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialBefore = await getTokenBalance(connection, auctioneerTwo.publicKey);
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                bestOfferToken = await getBestOfferTokenAccount(engine, vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 2);

                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: auctioneerOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [auctioneerOne]
                );

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    auctioneerOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialAfter = await getTokenBalance(connection, auctioneerTwo.publicKey);
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                expect(initialAfter - initialBefore).equals(baseFastOrder.initAuctionFee);
                expect(highestOfferAfter - highestOfferBefore).equals(
                    baseFastOrder.maxFee + newOffer
                );
                expect(custodyBefore - custodyAfter).equals(
                    baseFastOrder.initAuctionFee + baseFastOrder.maxFee + newOffer
                );

                // Validate auction data account.
                expect(auctionDataAfter.bump).to.equal(250);
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOffer).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOffer).to.eql(initialOfferToken);
                expect(auctionDataAfter.startSlot.toString()).to.eql(
                    auctionDataBefore.startSlot.toString()
                );
                expect(auctionDataAfter.amount.toString()).to.eql(
                    auctionDataBefore.amount.toString()
                );
                expect(auctionDataAfter.securityDeposit.toString()).to.eql(
                    auctionDataBefore.securityDeposit.toString()
                );
                expect(auctionDataAfter.offerPrice.toString()).to.eql(newOffer.toString());
            });
        });
    });
});

async function placeInitialOfferForTest(
    connection: Connection,
    auctioneer: Keypair,
    sequence: bigint,
    fastOrder: FastMarketOrder,
    emitter: number[],
    engine: MatchingEngineProgram,
    args: {
        feeOffer: bigint;
        fromChain: ChainId;
        toChain: ChainId;
    }
): Promise<[PublicKey, Buffer]> {
    const [vaaKey, signedVaa] = await postFastTransferVaa(
        connection,
        auctioneer,
        MOCK_GUARDIANS,
        sequence,
        fastOrder,
        "0x" + Buffer.from(emitter).toString("hex")
    );

    // Place the initial offer.
    await expectIxOk(
        connection,
        [
            await engine.placeInitialOfferIx(
                args.feeOffer,
                args.fromChain,
                args.toChain,
                keccak256(parseVaa(signedVaa).hash),
                {
                    payer: auctioneer.publicKey,
                    vaa: vaaKey,
                    mint: USDC_MINT_ADDRESS,
                }
            ),
        ],
        [auctioneer]
    );

    return [vaaKey, signedVaa];
}
