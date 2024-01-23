import * as wormholeSdk from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    AuctionConfig,
    Custodian,
    MatchingEngineProgram,
    RouterEndpoint,
} from "../src/matchingEngine";
import {
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    postLiquidityLayerVaa,
} from "./helpers";
import {
    calculateDynamicPenalty,
    getTokenBalance,
    postFastTransferVaa,
    postVaaWithMessage,
    skip_slots,
    verifyFastFillMessage,
    verifyFillMessage,
} from "./helpers/matching_engine_utils";
import {
    CctpTokenBurnMessage,
    FastMarketOrder,
    FastFill,
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
} from "../src";
import { VaaAccount } from "../src/wormhole";

chaiUse(chaiAsPromised);

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // owner is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const owner = Keypair.generate();
    const relayer = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeRecipient = Keypair.generate();
    const newFeeRecipient = Keypair.generate();
    const offerAuthorityOne = Keypair.generate();
    const offerAuthorityTwo = Keypair.generate();

    // Foreign endpoints.
    const ethChain = wormholeSdk.CHAINS.ethereum;
    const ethRouter = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const ethDomain = 0;
    const arbChain = wormholeSdk.CHAINS.arbitrum;
    const arbRouter = Array.from(Buffer.alloc(32, "bead", "hex"));
    const arbDomain = 3;
    const solanaChain = wormholeSdk.CHAINS.solana;
    const solanaRouter = Array.from(Buffer.alloc(32, "c0ffee", "hex"));
    const solanaDomain = 5;

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

            it("Cannot Initialize without USDC Mint", async function () {
                const mint = await splToken.createMint(connection, payer, payer.publicKey, null, 6);

                await expectIxErr(
                    connection,
                    [await createInitializeIx({ mint })],
                    [payer],
                    "NotUsdc"
                );
            });

            it("Cannot Initialize with Default Owner Assistant", async function () {
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

            it("Cannot Initialize with Default Fee Recipient", async function () {
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

            it("Cannot Initialize with Invalid Auction Duration", async function () {
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

            it("Cannot Initialize with Invalid Auction Grace Period", async function () {
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

            it("Cannot Initialize with Invalid User Penalty", async function () {
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

            it("Cannot Initialize with Invalid Initial Penalty", async function () {
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

            after("Transfer Lamports to Owner and Owner Assistant", async function () {
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
            it("Cannot Add Router Endpoint as Non-Owner and Non-Assistant", async function () {
                const ix = await engine.addRouterEndpointIx(
                    { ownerOrAssistant: payer.publicKey },
                    {
                        chain: ethChain,
                        address: ethRouter,
                        mintRecipient: null,
                    }
                );

                await expectIxErr(connection, [ix], [payer], "OwnerOrAssistantOnly");
            });

            [wormholeSdk.CHAINS.unset, solanaChain].forEach((chain) =>
                it(`Cannot Register Chain ID == ${chain}`, async function () {
                    const chain = 0;

                    await expectIxErr(
                        connection,
                        [
                            await engine.addRouterEndpointIx(
                                { ownerOrAssistant: owner.publicKey },
                                { chain, address: ethRouter, mintRecipient: null }
                            ),
                        ],
                        [owner],
                        "ChainNotAllowed"
                    );
                })
            );

            it("Cannot Register Zero Address", async function () {
                const ix = await engine.addRouterEndpointIx(
                    { ownerOrAssistant: owner.publicKey },
                    {
                        chain: ethChain,
                        address: new Array(32).fill(0),
                        mintRecipient: null,
                    }
                );

                await expectIxErr(connection, [ix], [owner], "InvalidEndpoint");
            });

            it(`Add Router Endpoint as Owner Assistant`, async function () {
                const contractAddress = Array.from(Buffer.alloc(32, "fbadc0de", "hex"));
                const mintRecipient = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const ix = await engine.addRouterEndpointIx(
                    { ownerOrAssistant: ownerAssistant.publicKey },
                    {
                        chain: ethChain,
                        address: contractAddress,
                        mintRecipient,
                    }
                );
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(ethChain)
                );
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(255, ethChain, contractAddress, mintRecipient)
                );
            });

            it(`Update Router Endpoint as Owner`, async function () {
                const ix = await engine.addRouterEndpointIx(
                    { ownerOrAssistant: owner.publicKey },
                    {
                        chain: ethChain,
                        address: ethRouter,
                        mintRecipient: null,
                    }
                );

                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(ethChain)
                );
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(255, ethChain, ethRouter, ethRouter)
                );
            });
        });

        describe("Add Local Router Endpoint", function () {
            const expectedEndpointBump = 254;

            it("Cannot Add Local Router Endpoint without Executable", async function () {
                const ix = await engine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: SYSVAR_RENT_PUBKEY,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: ConstraintExecutable"
                );
            });

            it("Add Local Router Endpoint using System Program", async function () {
                const ix = await engine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: SystemProgram.programId,
                });

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
                );
                const [expectedAddress] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    SystemProgram.programId
                );
                const [expectedMintRecipient] = PublicKey.findProgramAddressSync(
                    [Buffer.from("custody")],
                    SystemProgram.programId
                );
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(
                        expectedEndpointBump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        Array.from(expectedAddress.toBuffer()),
                        Array.from(expectedMintRecipient.toBuffer())
                    )
                );
            });

            it("Update Local Router Endpoint using SPL Token Program", async function () {
                const ix = await engine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: splToken.TOKEN_PROGRAM_ID,
                });

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
                );
                const [expectedAddress] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    splToken.TOKEN_PROGRAM_ID
                );
                const [expectedMintRecipient] = PublicKey.findProgramAddressSync(
                    [Buffer.from("custody")],
                    splToken.TOKEN_PROGRAM_ID
                );
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(
                        expectedEndpointBump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        Array.from(expectedAddress.toBuffer()),
                        Array.from(expectedMintRecipient.toBuffer())
                    )
                );
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
            destinationCctpDomain: arbDomain,
            redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
            sender: Array.from(Buffer.alloc(32, "beefdead", "hex")),
            refundAddress: Array.from(Buffer.alloc(32, "beef", "hex")),
            maxFee: 1000000n,
            initAuctionFee: 100n,
            deadline: 0,
            redeemerMessage: Buffer.from("All your base are belong to us."),
        };

        before("Register To Router Endpoints", async function () {
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
                            mintRecipient: null,
                        }
                    ),
                ],
                [owner]
            );
        });

        before("Transfer Lamports to Offer Authorities", async function () {
            await expectIxOk(
                connection,
                [
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: offerAuthorityOne.publicKey,
                        lamports: 1000000000,
                    }),
                    SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: offerAuthorityTwo.publicKey,
                        lamports: 1000000000,
                    }),
                ],
                [payer]
            );
        });

        before("Create ATAs For Offer Authorities", async function () {
            for (const wallet of [offerAuthorityOne, offerAuthorityTwo]) {
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    wallet,
                    USDC_MINT_ADDRESS,
                    wallet.publicKey
                );

                // Mint USDC.
                const mintAmount = 100000n * 100000000n;
                const destination = splToken.getAssociatedTokenAddressSync(
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
            for (const offerPrice of [0n, baseFastOrder.maxFee / 2n, baseFastOrder.maxFee]) {
                it(`Place Initial Offer (Price == ${offerPrice})`, async function () {
                    // Fetch the balances before.
                    const offerBalanceBefore = await getTokenBalance(
                        connection,
                        offerAuthorityOne.publicKey
                    );
                    const custodyBefore = (
                        await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                    ).amount;

                    const [, signedVaa] = await placeInitialOfferForTest(
                        connection,
                        offerAuthorityOne,
                        wormholeSequence++,
                        baseFastOrder,
                        ethRouter,
                        engine,
                        {
                            feeOffer: offerPrice,
                            fromChain: ethChain,
                            toChain: arbChain,
                        }
                    );

                    // Validate balance changes.
                    const offerBalanceAfter = await getTokenBalance(
                        connection,
                        offerAuthorityOne.publicKey
                    );
                    const custodyAfter = (
                        await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                    ).amount;

                    expect(offerBalanceAfter).equals(
                        offerBalanceBefore - baseFastOrder.maxFee - baseFastOrder.amountIn
                    );
                    expect(custodyAfter).equals(
                        custodyBefore + baseFastOrder.maxFee + baseFastOrder.amountIn
                    );

                    // Confirm the auction data.
                    const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                    const auctionData = await engine.fetchAuctionData(vaaHash);
                    const slot = await connection.getSlot();
                    const offerToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        offerAuthorityOne.publicKey
                    );

                    expect(auctionData.vaaHash).to.eql(Array.from(vaaHash));
                    expect(auctionData.status).to.eql({ active: {} });
                    expect(auctionData.bestOfferToken).to.eql(offerToken);
                    expect(auctionData.initialOfferToken).to.eql(offerToken);
                    expect(auctionData.startSlot.toString()).to.eql(slot.toString());
                    expect(auctionData.amount.toString()).to.eql(baseFastOrder.amountIn.toString());
                    expect(auctionData.securityDeposit.toString()).to.eql(
                        baseFastOrder.maxFee.toString()
                    );
                    expect(auctionData.offerPrice.toString()).to.eql(offerPrice.toString());
                });
            }

            it(`Place Initial Offer (Offer Price == ${
                baseFastOrder.amountIn - 1n
            })`, async function () {
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;

                // Set the deadline to 10 slots from now.
                fastOrder.maxFee = fastOrder.amountIn - 1n;

                // Fetch the balances before.
                const offerBalanceBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: arbChain,
                    }
                );

                // Validate balance changes.
                const offerBalanceAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                expect(offerBalanceAfter).equals(
                    offerBalanceBefore - fastOrder.maxFee - fastOrder.amountIn
                );
                expect(custodyAfter).equals(custodyBefore + fastOrder.maxFee + fastOrder.amountIn);

                // Confirm the auction data.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const auctionData = await engine.fetchAuctionData(vaaHash);
                const slot = await connection.getSlot();
                const offerToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    offerAuthorityOne.publicKey
                );

                expect(auctionData.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionData.status).to.eql({ active: {} });
                expect(auctionData.bestOfferToken).to.eql(offerToken);
                expect(auctionData.initialOfferToken).to.eql(offerToken);
                expect(auctionData.startSlot.toString()).to.eql(slot.toString());
                expect(auctionData.amount.toString()).to.eql(fastOrder.amountIn.toString());
                expect(auctionData.securityDeposit.toString()).to.eql(fastOrder.maxFee.toString());
                expect(auctionData.offerPrice.toString()).to.eql(fastOrder.maxFee.toString());
            });

            it(`Place Initial Offer (With Deadline)`, async function () {
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;

                // Set the deadline to 10 slots from now.
                const currTime = await connection.getBlockTime(await connection.getSlot());
                if (currTime === null) {
                    throw new Error("Failed to get current block time");
                }
                fastOrder.deadline = currTime + 10;

                // Fetch the balances before.
                const offerBalanceBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: arbChain,
                    }
                );

                // Validate balance changes.
                const offerBalanceAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                expect(offerBalanceAfter).equals(
                    offerBalanceBefore - fastOrder.maxFee - fastOrder.amountIn
                );
                expect(custodyAfter).equals(custodyBefore + fastOrder.maxFee + fastOrder.amountIn);

                // Confirm the auction data.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const auctionData = await engine.fetchAuctionData(vaaHash);
                const slot = await connection.getSlot();
                const offerToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    offerAuthorityOne.publicKey
                );

                expect(auctionData.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionData.status).to.eql({ active: {} });
                expect(auctionData.bestOfferToken).to.eql(offerToken);
                expect(auctionData.initialOfferToken).to.eql(offerToken);
                expect(auctionData.startSlot.toString()).to.eql(slot.toString());
                expect(auctionData.amount.toString()).to.eql(fastOrder.amountIn.toString());
                expect(auctionData.securityDeposit.toString()).to.eql(fastOrder.maxFee.toString());
                expect(auctionData.offerPrice.toString()).to.eql(fastOrder.maxFee.toString());
            });

            it(`Cannot Place Initial Offer (Invalid VAA)`, async function () {
                const [vaaKey, signedVaa] = await postVaaWithMessage(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    Buffer.from("deadbeef", "hex"),
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "InvalidVaa"
                );
            });

            it(`Cannot Place Initial Offer (Invalid Payload)`, async function () {
                const fastFill = {
                    fill: {
                        sourceChain: ethChain,
                        orderSender: Array.from(baseFastOrder.sender),
                        redeemer: Array.from(baseFastOrder.redeemer),
                        redeemerMessage: baseFastOrder.redeemerMessage,
                    },
                    amount: 1000n,
                } as FastFill;
                const payload = new LiquidityLayerMessage({ fastFill: fastFill }).encode();

                const [vaaKey, signedVaa] = await postVaaWithMessage(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    payload,
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "NotFastMarketOrder"
                );
            });

            it(`Cannot Place Initial Offer (Deadline Exceeded)`, async function () {
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;

                // Set the deadline to the previous block timestamp.
                const currTime = await connection.getBlockTime(await connection.getSlot());
                if (currTime === null) {
                    throw new Error("Failed to get current block time");
                }
                fastOrder.deadline = currTime + -1;

                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    fastOrder,
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            fastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "FastMarketOrderExpired"
                );
            });

            it(`Cannot Place Initial Offer (Offer Price Too High)`, async function () {
                const feeOffer = baseFastOrder.maxFee + 1n;

                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    baseFastOrder,
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            feeOffer,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "OfferPriceTooHigh"
                );
            });

            it(`Cannot Place Initial Offer (Invalid Emitter Chain)`, async function () {
                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    baseFastOrder,
                    "0x" + Buffer.from(ethRouter).toString("hex"),
                    wormholeSdk.CHAINS.acala // Pass invalid emitter chain.
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "ErrInvalidSourceRouter"
                );
            });

            it(`Cannot Place Initial Offer (Invalid Emitter Address)`, async function () {
                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    baseFastOrder,
                    "0x" + Buffer.from(arbRouter).toString("hex") // Pass arbRouter instead of ethRouter.
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "ErrInvalidSourceRouter"
                );
            });

            it(`Cannot Place Initial Offer (Invalid Target Router Chain)`, async function () {
                // Change the fast order chain Id.
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;
                fastOrder.targetChain = wormholeSdk.CHAINS.acala;

                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    fastOrder,
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            fastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "ErrInvalidTargetRouter"
                );
            });

            it(`Cannot Place Initial Offer Again`, async function () {
                const [vaaKey, signedVaa] = await postFastTransferVaa(
                    connection,
                    offerAuthorityOne,
                    MOCK_GUARDIANS,
                    wormholeSequence++,
                    baseFastOrder,
                    "0x" + Buffer.from(ethRouter).toString("hex")
                );

                await expectIxOk(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne]
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.placeInitialOfferIx(
                            baseFastOrder.maxFee,
                            ethChain,
                            arbChain,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                payer: offerAuthorityOne.publicKey,
                                vaa: vaaKey,
                                mint: USDC_MINT_ADDRESS,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "already in use"
                );
            });
        });

        describe("Improve Offer", function () {
            for (const newOffer of [0n, baseFastOrder.maxFee / 2n, baseFastOrder.maxFee - 1n]) {
                it(`Improve Offer (Price == ${newOffer})`, async function () {
                    const [, signedVaa] = await placeInitialOfferForTest(
                        connection,
                        offerAuthorityOne,
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

                    const initialOfferBalanceBefore = await getTokenBalance(
                        connection,
                        offerAuthorityOne.publicKey
                    );
                    const newOfferBalanceBefore = await getTokenBalance(
                        connection,
                        offerAuthorityTwo.publicKey
                    );
                    const custodyBefore = (
                        await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                    ).amount;

                    // New Offer from offerAuthorityTwo.
                    const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                    const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                    const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                    await expectIxOk(
                        connection,
                        [
                            await engine.improveOfferIx(
                                newOffer,
                                wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                                {
                                    offerAuthority: offerAuthorityTwo.publicKey,
                                    bestOfferToken,
                                }
                            ),
                        ],
                        [offerAuthorityTwo]
                    );

                    // Validate balance changes.
                    const initialOfferBalanceAfter = await getTokenBalance(
                        connection,
                        offerAuthorityOne.publicKey
                    );
                    const newOfferBalanceAfter = await getTokenBalance(
                        connection,
                        offerAuthorityTwo.publicKey
                    );
                    const custodyAfter = (
                        await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                    ).amount;

                    expect(newOfferBalanceAfter).equals(
                        newOfferBalanceBefore - baseFastOrder.maxFee - baseFastOrder.amountIn
                    );
                    expect(initialOfferBalanceAfter).equals(
                        initialOfferBalanceBefore + baseFastOrder.maxFee + baseFastOrder.amountIn
                    );
                    expect(custodyAfter).equals(custodyBefore);

                    // Confirm the auction data.
                    const auctionDataAfter = await engine.fetchAuctionData(vaaHash);
                    const newOfferToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        offerAuthorityTwo.publicKey
                    );
                    const initialOfferToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        offerAuthorityOne.publicKey
                    );

                    expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                    expect(auctionDataAfter.status).to.eql({ active: {} });
                    expect(auctionDataAfter.bestOfferToken).to.eql(newOfferToken);
                    expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
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
            }

            it(`Improve Offer With Highest Offer Account`, async function () {
                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                const initialOfferBalanceBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                // New Offer from offerAuthorityOne.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const newOffer = baseFastOrder.maxFee - 100n;
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                await expectIxOk(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne]
                );

                // Validate balance changes (nothing should change).
                const initialOfferBalanceAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;

                expect(initialOfferBalanceAfter).equals(initialOfferBalanceBefore);
                expect(custodyAfter).equals(custodyBefore);

                // Confirm the auction data.
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);
                const initialOfferToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    offerAuthorityOne.publicKey
                );

                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ active: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(auctionDataAfter.bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
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

            it(`Cannot Improve Offer (Auction Expired)`, async function () {
                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                // New Offer from offerAuthorityOne.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const newOffer = baseFastOrder.maxFee - 100n;
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                await skip_slots(connection, 3);

                await expectIxErr(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "AuctionPeriodExpired"
                );
            });

            it(`Cannot Improve Offer (Invalid Best Offer Token Account)`, async function () {
                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                // New Offer from offerAuthorityOne.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const newOffer = baseFastOrder.maxFee - 100n;

                // Pass the wrong address for the best offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken: engine.custodyTokenAccountAddress(),
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "InvalidTokenAccount"
                );
            });

            it(`Cannot Improve Offer (Auction Not Active)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                // New Offer from offerAuthorityOne.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const newOffer = baseFastOrder.maxFee - 100n;
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                await skip_slots(connection, 3);

                // Excute the fast order so that the auction status changes.
                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                        }),
                    ],
                    [offerAuthorityOne]
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "AuctionNotActive"
                );
            });

            it(`Cannot Improve Offer (Offer Price Not Improved)`, async function () {
                const [, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                // New Offer from offerAuthorityOne.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                await expectIxErr(
                    connection,
                    [
                        await engine.improveOfferIx(
                            baseFastOrder.maxFee, // Offer price not improved.
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne],
                    "OfferPriceNotImproved"
                );
            });
        });

        describe("Execute Fast Order", function () {
            it("Execute Fast Order Within Grace Period", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityTwo,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                let bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);
                const newOffer = baseFastOrder.maxFee - 100n;

                // Improve the bid with offer one.
                await expectIxOk(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne]
                );

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialBefore = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 2);
                const message = await engine.getCoreMessage(offerAuthorityOne.publicKey);
                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne]
                );

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialAfter = await getTokenBalance(connection, offerAuthorityTwo.publicKey);
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                expect(initialAfter - initialBefore).equals(baseFastOrder.initAuctionFee);
                expect(highestOfferAfter - highestOfferBefore).equals(
                    baseFastOrder.maxFee + newOffer
                );
                expect(custodyBefore - custodyAfter).equals(
                    baseFastOrder.amountIn + baseFastOrder.maxFee
                );

                // Validate auction data account.
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
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

                // Validate the core message.
                await verifyFillMessage(
                    connection,
                    message,
                    baseFastOrder.amountIn - newOffer - baseFastOrder.initAuctionFee,
                    arbDomain,
                    {
                        sourceChain: ethChain,
                        orderSender: Array.from(baseFastOrder.sender),
                        redeemer: Array.from(baseFastOrder.redeemer),
                        redeemerMessage: baseFastOrder.redeemerMessage,
                    }
                );
            });

            it("Execute Fast Order Within Grace Period (Target == Solana)", async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityTwo,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                let bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);
                const newOffer = fastOrder.maxFee - 100n;

                // Improve the bid with offer one.
                await expectIxOk(
                    connection,
                    [
                        await engine.improveOfferIx(
                            newOffer,
                            wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                            {
                                offerAuthority: offerAuthorityOne.publicKey,
                                bestOfferToken,
                            }
                        ),
                    ],
                    [offerAuthorityOne]
                );

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialBefore = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);
                bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 2);
                const message = await engine.getCoreMessage(offerAuthorityOne.publicKey);
                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne]
                );

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const initialAfter = await getTokenBalance(connection, offerAuthorityTwo.publicKey);
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                expect(initialAfter - initialBefore).equals(fastOrder.initAuctionFee);
                expect(highestOfferAfter - highestOfferBefore).equals(fastOrder.maxFee + newOffer);
                expect(custodyBefore - custodyAfter).equals(
                    fastOrder.maxFee + newOffer + fastOrder.initAuctionFee
                );

                // Validate auction data account.
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
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

                // Validate the core message.
                await verifyFastFillMessage(
                    connection,
                    message,
                    fastOrder.amountIn - newOffer - fastOrder.initAuctionFee,
                    {
                        sourceChain: ethChain,
                        orderSender: Array.from(fastOrder.sender),
                        redeemer: Array.from(fastOrder.redeemer),
                        redeemerMessage: fastOrder.redeemerMessage,
                    }
                );
            });

            it("Execute Fast Order After Grace Period", async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 7);
                const message = await engine.getCoreMessage(offerAuthorityOne.publicKey);
                const txnSignature = await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne]
                );
                const txnSlot = await connection.getSignatureStatus(txnSignature).then((status) => {
                    return status.value!.slot;
                });

                // Compute the expected penalty and user reward.
                const [, expectedReward] = await calculateDynamicPenalty(
                    (
                        await engine.fetchCustodian(engine.custodianAddress())
                    ).auctionConfig,
                    Number(baseFastOrder.maxFee),
                    txnSlot - Number(auctionDataBefore.startSlot)
                );

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                // The highest bidder is also the initial bidder in this case. The highest bidder
                // is also executing the fast order after the grace period has ended, so they will
                // be penalized by the expected user reward portion of the penalty.
                expect(highestOfferAfter - highestOfferBefore).equals(
                    baseFastOrder.maxFee +
                        baseFastOrder.maxFee +
                        baseFastOrder.initAuctionFee -
                        BigInt(expectedReward)
                );
                expect(custodyBefore - custodyAfter).equals(
                    baseFastOrder.amountIn + baseFastOrder.maxFee
                );

                // Validate auction data account.
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
                expect(auctionDataAfter.startSlot.toString()).to.eql(
                    auctionDataBefore.startSlot.toString()
                );
                expect(auctionDataAfter.amount.toString()).to.eql(
                    auctionDataBefore.amount.toString()
                );
                expect(auctionDataAfter.securityDeposit.toString()).to.eql(
                    auctionDataBefore.securityDeposit.toString()
                );
                expect(auctionDataAfter.offerPrice.toString()).to.eql(
                    baseFastOrder.maxFee.toString()
                );

                // Validate the core message.
                await verifyFillMessage(
                    connection,
                    message,
                    baseFastOrder.amountIn -
                        baseFastOrder.maxFee -
                        baseFastOrder.initAuctionFee +
                        BigInt(expectedReward),
                    arbDomain,
                    {
                        sourceChain: ethChain,
                        orderSender: Array.from(baseFastOrder.sender),
                        redeemer: Array.from(baseFastOrder.redeemer),
                        redeemerMessage: baseFastOrder.redeemerMessage,
                    }
                );
            });

            it(`Execute Fast Order With Liquidator (Within Penalty Period)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const liquidatorBefore = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);

                // Fast forward into tge penalty period.
                await skip_slots(connection, 10);

                // Execute the fast order with the liquidator (offerAuthorityTwo).
                const message = await engine.getCoreMessage(offerAuthorityTwo.publicKey);
                const txnSignature = await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityTwo.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityTwo]
                );
                const txnSlot = await connection.getSignatureStatus(txnSignature).then((status) => {
                    return status.value!.slot;
                });

                // Compute the expected penalty and user reward.
                const [expectedPenalty, expectedReward] = await calculateDynamicPenalty(
                    (
                        await engine.fetchCustodian(engine.custodianAddress())
                    ).auctionConfig,
                    Number(baseFastOrder.maxFee),
                    txnSlot - Number(auctionDataBefore.startSlot)
                );

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const liquidatorAfter = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                expect(highestOfferAfter - highestOfferBefore).equals(
                    baseFastOrder.maxFee +
                        baseFastOrder.maxFee +
                        baseFastOrder.initAuctionFee -
                        BigInt(expectedReward) -
                        BigInt(expectedPenalty)
                );
                expect(liquidatorAfter - liquidatorBefore).equals(BigInt(expectedPenalty));
                expect(custodyBefore - custodyAfter).equals(
                    baseFastOrder.amountIn + baseFastOrder.maxFee
                );

                // Validate auction data account.
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
                expect(auctionDataAfter.startSlot.toString()).to.eql(
                    auctionDataBefore.startSlot.toString()
                );
                expect(auctionDataAfter.amount.toString()).to.eql(
                    auctionDataBefore.amount.toString()
                );
                expect(auctionDataAfter.securityDeposit.toString()).to.eql(
                    auctionDataBefore.securityDeposit.toString()
                );
                expect(auctionDataAfter.offerPrice.toString()).to.eql(
                    baseFastOrder.maxFee.toString()
                );

                // Validate the core message.
                await verifyFillMessage(
                    connection,
                    message,
                    baseFastOrder.amountIn -
                        baseFastOrder.maxFee -
                        baseFastOrder.initAuctionFee +
                        BigInt(expectedReward),
                    arbDomain,
                    {
                        sourceChain: ethChain,
                        orderSender: Array.from(baseFastOrder.sender),
                        redeemer: Array.from(baseFastOrder.redeemer),
                        redeemerMessage: baseFastOrder.redeemerMessage,
                    }
                );
            });

            it(`Execute Fast Order With Liquidator (Post Penalty Period)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fetch the balances before.
                const highestOfferBefore = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const custodyBefore = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const liquidatorBefore = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const auctionDataBefore = await engine.fetchAuctionData(vaaHash);

                // Fast forward past the penalty period.
                await skip_slots(connection, 15);

                // Execute the fast order with the liquidator (offerAuthorityTwo).
                const message = await engine.getCoreMessage(offerAuthorityTwo.publicKey);
                const txnSignature = await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityTwo.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityTwo]
                );
                const txnSlot = await connection.getSignatureStatus(txnSignature).then((status) => {
                    return status.value!.slot;
                });

                // Compute the expected penalty and user reward.
                const [expectedPenalty, expectedReward] = await calculateDynamicPenalty(
                    (
                        await engine.fetchCustodian(engine.custodianAddress())
                    ).auctionConfig,
                    Number(baseFastOrder.maxFee),
                    txnSlot - Number(auctionDataBefore.startSlot)
                );

                // Since we are beyond the penalty period, the entire security deposit
                // is divided between the highest bidder and the liquidator.
                expect(baseFastOrder.maxFee).equals(BigInt(expectedReward + expectedPenalty));

                // Validate balance changes.
                const highestOfferAfter = await getTokenBalance(
                    connection,
                    offerAuthorityOne.publicKey
                );
                const liquidatorAfter = await getTokenBalance(
                    connection,
                    offerAuthorityTwo.publicKey
                );
                const custodyAfter = (
                    await splToken.getAccount(connection, engine.custodyTokenAccountAddress())
                ).amount;
                const auctionDataAfter = await engine.fetchAuctionData(vaaHash);

                expect(highestOfferAfter - highestOfferBefore).equals(
                    baseFastOrder.maxFee +
                        baseFastOrder.maxFee +
                        baseFastOrder.initAuctionFee -
                        BigInt(expectedReward) -
                        BigInt(expectedPenalty)
                );
                expect(liquidatorAfter - liquidatorBefore).equals(BigInt(expectedPenalty));
                expect(custodyBefore - custodyAfter).equals(
                    baseFastOrder.amountIn + baseFastOrder.maxFee
                );

                // Validate auction data account.
                expect(auctionDataAfter.vaaHash).to.eql(Array.from(vaaHash));
                expect(auctionDataAfter.status).to.eql({ completed: {} });
                expect(auctionDataAfter.bestOfferToken).to.eql(bestOfferToken);
                expect(auctionDataAfter.initialOfferToken).to.eql(initialOfferToken);
                expect(auctionDataAfter.startSlot.toString()).to.eql(
                    auctionDataBefore.startSlot.toString()
                );
                expect(auctionDataAfter.amount.toString()).to.eql(
                    auctionDataBefore.amount.toString()
                );
                expect(auctionDataAfter.securityDeposit.toString()).to.eql(
                    auctionDataBefore.securityDeposit.toString()
                );
                expect(auctionDataAfter.offerPrice.toString()).to.eql(
                    baseFastOrder.maxFee.toString()
                );

                // Validate the core message.
                await verifyFillMessage(
                    connection,
                    message,
                    baseFastOrder.amountIn -
                        baseFastOrder.maxFee -
                        baseFastOrder.initAuctionFee +
                        BigInt(expectedReward),
                    arbDomain,
                    {
                        sourceChain: ethChain,
                        orderSender: Array.from(baseFastOrder.sender),
                        redeemer: Array.from(baseFastOrder.redeemer),
                        redeemerMessage: baseFastOrder.redeemerMessage,
                    }
                );
            });

            it(`Cannot Execute Fast Order (Invalid Chain)`, async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(solanaChain, solanaDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidChain"
                );
            });

            it(`Cannot Execute Fast Order (Vaa Hash Mismatch)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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

                const [vaaKey2, signedVaa2] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const vaaHash2 = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa2).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fast forward past the penalty period.
                await skip_slots(connection, 15);

                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash2, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "MismatchedVaaHash"
                );
            });

            it(`Cannot Execute Fast Order (Invalid Best Offer Token Account)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Pass the wrong address for the best offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken: engine.custodyTokenAccountAddress(),
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidTokenAccount"
                );
            });

            it(`Cannot Execute Fast Order (Invalid Initial Offer Token Account)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                // Pass the wrong address for the initial offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken: engine.custodyTokenAccountAddress(),
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidTokenAccount"
                );
            });

            it(`Cannot Execute Fast Order (Auction Not Active)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 4);

                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne]
                );

                // Should already be completed.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "AuctionNotActive"
                );
            });

            it(`Cannot Execute Fast Order (Auction Period Not Expired)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Do not fast forward into the grace period.

                // Pass the wrong address for the initial offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderIx(arbChain, arbDomain, vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "AuctionPeriodNotExpired"
                );
            });

            it(`Cannot Execute Fast Order Solana (Invalid Chain)`, async function () {
                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
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
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                            toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidChain"
                );
            });

            it(`Cannot Execute Fast Order Solana (Vaa Hash Mismatch)`, async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: baseFastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                const [vaaKey2, signedVaa2] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const vaaHash2 = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa2).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fast forward past the penalty period.
                await skip_slots(connection, 15);

                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash2, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "MismatchedVaaHash"
                );
            });

            it(`Cannot Execute Fast Order Solana (Invalid Best Offer Token Account)`, async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Pass the wrong address for the best offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken: engine.custodyTokenAccountAddress(),
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidTokenAccount"
                );
            });

            it(`Cannot Execute Fast Order Solana (Invalid Initial Offer Token Account)`, async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);

                // Pass the wrong address for the initial offer token account.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken: engine.custodyTokenAccountAddress(),
                        }),
                    ],
                    [offerAuthorityOne],
                    "InvalidTokenAccount"
                );
            });

            it(`Cannot Execute Fast Order Solana (Auction Not Active)`, async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = wormholeSdk.CHAIN_ID_SOLANA;
                fastOrder.destinationCctpDomain = solanaDomain;

                const [vaaKey, signedVaa] = await placeInitialOfferForTest(
                    connection,
                    offerAuthorityOne,
                    wormholeSequence++,
                    fastOrder,
                    ethRouter,
                    engine,
                    {
                        feeOffer: fastOrder.maxFee,
                        fromChain: ethChain,
                        toChain: solanaChain,
                    }
                );

                // Accounts for the instruction.
                const vaaHash = wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash);
                const bestOfferToken = await engine.getBestOfferTokenAccount(vaaHash);
                const initialOfferToken = await engine.getInitialOfferTokenAccount(vaaHash);

                // Fast forward into the grace period.
                await skip_slots(connection, 4);

                await expectIxOk(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne]
                );

                // Should already be completed.
                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderSolanaIx(vaaHash, {
                            payer: offerAuthorityOne.publicKey,
                            vaa: vaaKey,
                            bestOfferToken,
                            initialOfferToken,
                        }),
                    ],
                    [offerAuthorityOne],
                    "AuctionNotActive"
                );
            });
        });

        describe("Prepare Auction Settlement", function () {
            let testCctpNonce = 2n ** 64n - 1n;

            // Hack to prevent math overflow error when invoking CCTP programs.
            testCctpNonce -= 10n * 6400n;

            const localVariables = new Map<string, any>();

            // TODO: add negative tests

            it("Prepare Auction Settlement", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(engine, sourceCctpDomain, cctpNonce, amountIn);

                const fastMessage = new LiquidityLayerMessage({
                    fastMarketOrder: {
                        amountIn,
                        minAmountOut: 0n,
                        targetChain: wormholeSdk.CHAIN_ID_SOLANA as number,
                        destinationCctpDomain,
                        redeemer: Array.from(redeemer.publicKey.toBuffer()),
                        sender: new Array(32).fill(0),
                        refundAddress: new Array(32).fill(0),
                        maxFee: 42069n,
                        initAuctionFee: 2000n,
                        deadline: 2,
                        redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                    },
                });

                const finalizedMessage = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit(
                        {
                            tokenAddress: burnMessage.burnTokenAddress,
                            amount: amountIn,
                            sourceCctpDomain,
                            destinationCctpDomain,
                            cctpNonce,
                            burnSource,
                            mintRecipient: Array.from(
                                engine.custodyTokenAccountAddress().toBuffer()
                            ),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        }
                    ),
                });

                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    fastMessage
                );
                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage
                );

                const ix = await engine.prepareAuctionSettlementCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                        mint: USDC_MINT_ADDRESS,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    }
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 250_000,
                });

                await expectIxOk(connection, [computeIx, ix], [payer]);

                // TODO: validate prepared slow order
                const fastVaaHash = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    vaa.digest()
                );
                const preparedAuctionSettlement = engine.preparedAuctionSettlementAddress(
                    payer.publicKey,
                    fastVaaHash
                );

                // Save for later.
                localVariables.set("ix", ix);
                localVariables.set("preparedAuctionSettlement", preparedAuctionSettlement);
            });

            it("Cannot Prepare Auction Settlement for Same VAAs", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                const preparedAuctionSettlement = localVariables.get(
                    "preparedAuctionSettlement"
                ) as PublicKey;
                expect(localVariables.delete("preparedAuctionSettlement")).is.true;

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    `Allocate: account Address { address: ${preparedAuctionSettlement.toString()}, base: None } already in use`
                );
            });
        });
    });
});

async function placeInitialOfferForTest(
    connection: Connection,
    offerAuthority: Keypair,
    sequence: bigint,
    fastOrder: FastMarketOrder,
    emitter: number[],
    engine: MatchingEngineProgram,
    args: {
        feeOffer: bigint;
        fromChain: wormholeSdk.ChainId;
        toChain: wormholeSdk.ChainId;
    }
): Promise<[PublicKey, Buffer]> {
    const [vaaKey, signedVaa] = await postFastTransferVaa(
        connection,
        offerAuthority,
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
                wormholeSdk.keccak256(wormholeSdk.parseVaa(signedVaa).hash),
                {
                    payer: offerAuthority.publicKey,
                    vaa: vaaKey,
                    mint: USDC_MINT_ADDRESS,
                }
            ),
        ],
        [offerAuthority]
    );

    return [vaaKey, signedVaa];
}

async function craftCctpTokenBurnMessage(
    engine: MatchingEngineProgram,
    sourceCctpDomain: number,
    cctpNonce: bigint,
    amount: bigint,
    overrides: { destinationCctpDomain?: number } = {}
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = engine.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
        messageTransmitterProgram.messageTransmitterConfigAddress()
    );
    const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

    const tokenMessengerMinterProgram = engine.tokenMessengerMinterProgram();
    const { tokenMessenger: sourceTokenMessenger } =
        await tokenMessengerMinterProgram.fetchRemoteTokenMessenger(
            tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceCctpDomain)
        );

    const burnMessage = new CctpTokenBurnMessage(
        {
            version,
            sourceDomain: sourceCctpDomain,
            destinationDomain: destinationCctpDomain,
            nonce: cctpNonce,
            sender: sourceTokenMessenger,
            recipient: Array.from(tokenMessengerMinterProgram.ID.toBuffer()), // targetTokenMessenger
            targetCaller: Array.from(engine.custodianAddress().toBuffer()), // targetCaller
        },
        0,
        Array.from(wormholeSdk.tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "ethereum")), // sourceTokenAddress
        Array.from(engine.custodyTokenAccountAddress().toBuffer()), // mint recipient
        amount,
        new Array(32).fill(0) // burnSource
    );

    const encodedCctpMessage = burnMessage.encode();
    const cctpAttestation = new CircleAttester().createAttestation(encodedCctpMessage);

    return {
        destinationCctpDomain,
        burnMessage,
        encodedCctpMessage,
        cctpAttestation,
    };
}
