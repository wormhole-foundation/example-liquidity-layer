import * as wormholeSdk from "@certusone/wormhole-sdk";
import { getPostedMessage } from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    VersionedTransactionResponse,
} from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { CctpTokenBurnMessage } from "../src/cctp";
import {
    FastMarketOrder,
    Fill,
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    SlowOrderResponse,
} from "../src/common";
import {
    Auction,
    AuctionConfig,
    AuctionParameters,
    Custodian,
    MatchingEngineProgram,
    Proposal,
    RouterEndpoint,
    localnet,
} from "../src/matchingEngine";
import { VaaAccount } from "../src/wormhole";
import {
    CHAIN_TO_DOMAIN,
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    REGISTERED_TOKEN_ROUTERS,
    USDC_MINT_ADDRESS,
    bigintToU64BN,
    expectIxErr,
    expectIxOk,
    expectIxOkDetails,
    getUsdcAtaBalance,
    numberToU64BN,
    postLiquidityLayerVaa,
    waitUntilSlot,
} from "./helpers";

chaiUse(chaiAsPromised);

const SLOTS_PER_EPOCH = 8;

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "confirmed");

    // owner is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const owner = OWNER_KEYPAIR;
    const relayer = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const feeRecipient = Keypair.generate().publicKey;
    const feeRecipientToken = splToken.getAssociatedTokenAddressSync(
        USDC_MINT_ADDRESS,
        feeRecipient,
    );
    const newFeeRecipient = Keypair.generate().publicKey;
    const playerOne = Keypair.generate();
    const playerTwo = Keypair.generate();
    const liquidator = Keypair.generate();

    // Foreign endpoints.
    const ethChain = wormholeSdk.coalesceChainId("ethereum");
    const ethRouter = REGISTERED_TOKEN_ROUTERS["ethereum"]!;
    const ethDomain = CHAIN_TO_DOMAIN["ethereum"]!;

    const arbChain = wormholeSdk.coalesceChainId("arbitrum");
    const arbRouter = REGISTERED_TOKEN_ROUTERS["arbitrum"]!;
    const arbDomain = CHAIN_TO_DOMAIN["arbitrum"]!;

    const solanaChain = wormholeSdk.coalesceChainId("solana");

    // Matching Engine program.
    const engine = new MatchingEngineProgram(connection, localnet(), USDC_MINT_ADDRESS);

    let lookupTableAddress: PublicKey;

    const auctionParams: AuctionParameters = {
        userPenaltyRewardBps: 250000, // 25%
        initialPenaltyBps: 250000, // 25%
        duration: 2,
        gracePeriod: 5,
        penaltyPeriod: 10,
        minOfferDeltaBps: 20000, // 2%
    };

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 10n * 6400n;

    let wormholeSequence = 1000n;

    describe("Admin", function () {
        describe("Initialize", function () {
            const localVariables = new Map<string, any>();

            it("Cannot Initialize without USDC Mint", async function () {
                const mint = await splToken.createMint(connection, payer, payer.publicKey, null, 6);

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint,
                    },
                    auctionParams,
                );
                await expectIxErr(connection, [ix], [payer], "mint. Error Code: ConstraintAddress");
            });

            it("Cannot Initialize with Default Owner Assistant", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: PublicKey.default,
                        feeRecipient,
                    },
                    auctionParams,
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: AssistantZeroPubkey");
            });

            it("Cannot Initialize with Default Fee Recipient", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient: PublicKey.default,
                    },
                    auctionParams,
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: FeeRecipientZeroPubkey");
            });

            it("Cannot Initialize with Invalid Auction Duration", async function () {
                const { duration: _, ...remaining } = auctionParams;

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { duration: 0, ...remaining },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: InvalidAuctionDuration");
            });

            it("Cannot Initialize with Invalid Auction Grace Period", async function () {
                const { gracePeriod: _, ...remaining } = auctionParams;

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { gracePeriod: 0, ...remaining },
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: InvalidAuctionGracePeriod",
                );
            });

            it("Cannot Initialize with Invalid User Penalty", async function () {
                const { userPenaltyRewardBps: _, ...remaining } = auctionParams;

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { userPenaltyRewardBps: 4294967295, ...remaining },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: UserPenaltyTooLarge");
            });

            it("Cannot Initialize with Invalid Initial Penalty", async function () {
                const { initialPenaltyBps: _, ...remaining } = auctionParams;

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { initialPenaltyBps: 4294967295, ...remaining },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: InitialPenaltyTooLarge");
            });

            it("Cannot Initialize with Invalid Min Offer Delta", async function () {
                const { minOfferDeltaBps: _, ...remaining } = auctionParams;

                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { minOfferDeltaBps: 4294967295, ...remaining },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: MinOfferDeltaTooLarge");
            });

            it("Finally Initialize Program", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    auctionParams,
                );
                await expectIxOk(connection, [ix], [payer]);

                const expectedAuctionConfigId = 0;
                const custodianData = await engine.fetchCustodian();
                expect(custodianData).to.eql(
                    new Custodian(
                        payer.publicKey,
                        null,
                        ownerAssistant.publicKey,
                        feeRecipientToken,
                        expectedAuctionConfigId,
                        bigintToU64BN(0n),
                    ),
                );

                const auctionConfigData = await engine.fetchAuctionConfig(0);
                expect(auctionConfigData).to.eql(
                    new AuctionConfig(expectedAuctionConfigId, auctionParams),
                );

                localVariables.set("ix", ix);
            });

            it("Cannot Call Instruction Again: initialize", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    `Allocate: account Address { address: ${engine
                        .custodianAddress()
                        .toString()}, base: None } already in use`,
                );
            });

            before("Set up Token Accounts", async function () {
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    feeRecipient,
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    PublicKey.default,
                );

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    SystemProgram.programId,
                );
            });

            after("Set Up Lookup Table", async function () {
                // Create.
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    }),
                );

                await expectIxOk(connection, [createIx], [payer]);

                const usdcCommonAccounts = await engine.commonAccounts();

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
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: playerOne.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: playerTwo.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: liquidator.publicKey,
                            lamports: 1000000000,
                        }),
                    ],
                    [payer],
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
                    [payer],
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await engine.fetchCustodian();

                expect(custodianData.pendingOwner).to.eql(owner.publicKey);
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner],
                );

                // Confirm that the owner config reflects the current ownership status.
                {
                    const custodianData = await engine.fetchCustodian();
                    expect(custodianData.owner).to.eql(owner.publicKey);
                    expect(custodianData.pendingOwner).to.eql(null);
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
                    "InvalidNewOwner",
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
                    "AlreadyOwner",
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
                    "OwnerOnly",
                );
            });

            it("Submit Ownership Transfer Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await engine.fetchCustodian();
                expect(custodianData.pendingOwner).to.eql(relayer.publicKey);
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
                    "NotPendingOwner",
                );
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx()],
                    [payer, relayer],
                );

                // Confirm that the owner config reflects the current ownership status.
                {
                    const custodianData = await engine.fetchCustodian();
                    expect(custodianData.owner).to.eql(relayer.publicKey);
                    expect(custodianData.pendingOwner).to.eql(null);
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
                    [payer, relayer],
                );

                await expectIxOk(
                    connection,
                    [await createConfirmOwnershipTransferIx({ sender: owner.publicKey })],
                    [payer, owner],
                );

                // Confirm that the payer is the owner again.
                {
                    const custodianData = await engine.fetchCustodian();
                    expect(custodianData.owner).to.eql(owner.publicKey);
                    expect(custodianData.pendingOwner).to.eql(null);
                }
            });

            it("Cannot Cancel Ownership Request as Non-Owner", async function () {
                // First, submit the ownership transfer request.
                await expectIxOk(
                    connection,
                    [await createSubmitOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm that the pending owner variable is set in the owner config.
                {
                    const custodianData = await engine.fetchCustodian();
                    expect(custodianData.pendingOwner).to.eql(relayer.publicKey);
                }

                // Confirm that the cancel ownership transfer request fails.
                await expectIxErr(
                    connection,
                    [await createCancelOwnershipTransferIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly",
                );
            });

            it("Cancel Ownership Request as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createCancelOwnershipTransferIx()],
                    [payer, owner],
                );

                // Confirm the pending owner field was reset.
                const custodianData = await engine.fetchCustodian();
                expect(custodianData.pendingOwner).to.eql(null);
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
                    "InvalidNewAssistant",
                );
            });

            it("Cannot Update Assistant as Non-Owner", async function () {
                await expectIxErr(
                    connection,
                    [await createUpdateOwnerAssistantIx({ sender: ownerAssistant.publicKey })],
                    [payer, ownerAssistant],
                    "OwnerOnly",
                );
            });

            it("Update Assistant as Owner", async function () {
                await expectIxOk(
                    connection,
                    [await createUpdateOwnerAssistantIx()],
                    [payer, owner],
                );

                // Confirm the assistant field was updated.
                const custodianData = await engine.fetchCustodian();
                expect(custodianData.ownerAssistant).to.eql(relayer.publicKey);

                // Set the assistant back to the assistant key.
                await expectIxOk(
                    connection,
                    [
                        await createUpdateOwnerAssistantIx({
                            newAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [payer, owner],
                );
            });
        });

        describe("Router Endpoint (CCTP)", function () {
            const localVariables = new Map<string, any>();

            it("Cannot Add Router Endpoint as Non-Owner and Non-Assistant", async function () {
                const ix = await engine.addCctpRouterEndpointIx(
                    { ownerOrAssistant: payer.publicKey },
                    {
                        chain: ethChain,
                        cctpDomain: ethDomain,
                        address: ethRouter,
                        mintRecipient: null,
                    },
                );

                await expectIxErr(connection, [ix], [payer], "OwnerOrAssistantOnly");
            });

            [wormholeSdk.CHAINS.unset, solanaChain].forEach((chain) =>
                it(`Cannot Register Chain ID == ${chain}`, async function () {
                    const chain = 0;

                    const ix = await engine.addCctpRouterEndpointIx(
                        { ownerOrAssistant: owner.publicKey },
                        { chain, cctpDomain: ethDomain, address: ethRouter, mintRecipient: null },
                    );
                    await expectIxErr(connection, [ix], [owner], "ChainNotAllowed");
                }),
            );

            it("Cannot Register Zero Address", async function () {
                const ix = await engine.addCctpRouterEndpointIx(
                    { ownerOrAssistant: owner.publicKey },
                    {
                        chain: ethChain,
                        cctpDomain: ethDomain,
                        address: new Array(32).fill(0),
                        mintRecipient: null,
                    },
                );

                await expectIxErr(connection, [ix], [owner], "InvalidEndpoint");
            });

            it("Add Router Endpoint as Owner Assistant", async function () {
                const contractAddress = Array.from(Buffer.alloc(32, "fbadc0de", "hex"));
                const mintRecipient = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const ix = await engine.addCctpRouterEndpointIx(
                    { ownerOrAssistant: ownerAssistant.publicKey },
                    {
                        chain: ethChain,
                        cctpDomain: ethDomain,
                        address: contractAddress,
                        mintRecipient,
                    },
                );
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await engine.fetchRouterEndpoint(ethChain);
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(255, ethChain, contractAddress, mintRecipient, {
                        cctp: { domain: ethDomain },
                    }),
                );

                // Save for later.
                localVariables.set("ix", ix);
            });

            it("Cannot Add Router Endpoint Again", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                const routerEndpoint = engine.routerEndpointAddress(ethChain);
                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    `Allocate: account Address { address: ${routerEndpoint.toString()}, base: None } already in use`,
                );
            });

            it("Cannot Disable Router Endpoint as Owner Assistant", async function () {
                const ix = await engine.disableRouterEndpointIx(
                    { owner: ownerAssistant.publicKey },
                    ethChain,
                );

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Disable Router Endpoint as Owner", async function () {
                const ix = await engine.disableRouterEndpointIx(
                    { owner: owner.publicKey },
                    ethChain,
                );

                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await engine.fetchRouterEndpoint(ethChain);
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(
                        bump,
                        ethChain,
                        new Array(32).fill(0),
                        new Array(32).fill(0),
                        { none: {} },
                    ),
                );
            });

            it("Cannot Update Router Endpoint as Owner Assistant", async function () {
                const ix = await engine.updateCctpRouterEndpointIx(
                    { owner: ownerAssistant.publicKey },
                    {
                        chain: ethChain,
                        cctpDomain: ethDomain,
                        address: ethRouter,
                        mintRecipient: null,
                    },
                );

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Update Router Endpoint as Owner", async function () {
                const ix = await engine.updateCctpRouterEndpointIx(
                    { owner: owner.publicKey },
                    {
                        chain: ethChain,
                        cctpDomain: ethDomain,
                        address: ethRouter,
                        mintRecipient: null,
                    },
                );

                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await engine.fetchRouterEndpoint(ethChain);
                expect(routerEndpointData).to.eql(
                    new RouterEndpoint(255, ethChain, ethRouter, ethRouter, {
                        cctp: { domain: ethDomain },
                    }),
                );
            });
        });

        describe("Update Fee Recipient", async function () {
            const localVariables = new Map<string, any>();

            it("Cannot Update Fee Recipient with Non-Existent ATA", async function () {
                const ix = await engine.updateFeeRecipientIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    newFeeRecipient,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "new_fee_recipient_token. Error Code: AccountNotInitialized",
                );

                localVariables.set("ix", ix);
            });

            it("Update Fee Recipient as Owner Assistant", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    newFeeRecipient,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const custodianData = await engine.fetchCustodian();
                expect(custodianData.feeRecipientToken).to.eql(
                    splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, newFeeRecipient),
                );
            });

            it("Cannot Update Fee Recipient without Owner or Assistant", async function () {
                const ix = await engine.updateFeeRecipientIx({
                    ownerOrAssistant: payer.publicKey,
                    newFeeRecipient: feeRecipient,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Cannot Update Fee Recipient to Default Pubkey", async function () {
                const ix = await engine.updateFeeRecipientIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    newFeeRecipient: PublicKey.default,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "FeeRecipientZeroPubkey");
            });

            it("Update Fee Recipient as Owner", async function () {
                const ix = await engine.updateFeeRecipientIx({
                    ownerOrAssistant: owner.publicKey,
                    newFeeRecipient: feeRecipient,
                });
                await expectIxOk(connection, [ix], [owner]);

                const custodianData = await engine.fetchCustodian();
                expect(custodianData.feeRecipientToken).to.eql(feeRecipientToken);
            });
        });

        describe("Propose New Auction Parameters", async function () {
            // Create a new set of auction parameters.
            const newAuctionParameters: AuctionParameters = {
                userPenaltyRewardBps: 1000000,
                initialPenaltyBps: 1000000,
                duration: 1,
                gracePeriod: 3,
                penaltyPeriod: 5,
                minOfferDeltaBps: 10000,
            };

            const localVariables = new Map<string, any>();

            it("Cannot Propose New Auction Parameters without Owner or Assistant", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: payer.publicKey,
                    },
                    newAuctionParameters,
                );

                await expectIxErr(connection, [ix], [payer], "OwnerOrAssistantOnly");
            });

            it("Cannot Propose New Auction Parameters (Invalid Auction Duration)", async function () {
                const { duration: _, ...remaining } = newAuctionParameters;

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { duration: 0, ...remaining },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: InvalidAuctionDuration",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid Auction Grace Period)", async function () {
                const { gracePeriod: _, ...remaining } = newAuctionParameters;

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { gracePeriod: 0, ...remaining },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: InvalidAuctionGracePeriod",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid User Penalty)", async function () {
                const { userPenaltyRewardBps: _, ...remaining } = newAuctionParameters;

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { userPenaltyRewardBps: 4294967295, ...remaining },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: UserPenaltyTooLarge",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid Initial Penalty)", async function () {
                const { initialPenaltyBps: _, ...remaining } = newAuctionParameters;

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { initialPenaltyBps: 4294967295, ...remaining },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: InitialPenaltyTooLarge",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid Min Offer Delta)", async function () {
                const { minOfferDeltaBps: _, ...remaining } = newAuctionParameters;

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { minOfferDeltaBps: 4294967295, ...remaining },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: MinOfferDeltaTooLarge",
                );
            });

            it("Propose New Auction Parameters as Owner Assistant", async function () {
                const { nextProposalId, auctionConfigId } = await engine.fetchCustodian();

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    newAuctionParameters,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const currentSlot = await connection.getSlot();

                // Fetch the proposal data and validate it.
                const proposal = await engine.proposalAddress(nextProposalId);
                const proposalData = await engine.fetchProposal({ address: proposal });

                expect(proposalData).to.eql(
                    new Proposal(
                        nextProposalId,
                        255,
                        {
                            updateAuctionParameters: {
                                id: auctionConfigId + 1,
                                parameters: newAuctionParameters,
                            },
                        },
                        ownerAssistant.publicKey,
                        owner.publicKey,
                        numberToU64BN(currentSlot),
                        numberToU64BN(currentSlot + SLOTS_PER_EPOCH),
                        null,
                    ),
                );

                localVariables.set("proposal", proposal);
                localVariables.set("ix", ix);
            });

            it("Cannot Propose New Auction Parameters with Proposal Already Existing", async function () {
                const proposal = localVariables.get("proposal") as PublicKey;
                expect(localVariables.delete("proposal")).is.true;

                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    `Allocate: account Address { address: ${proposal.toString()}, base: None } already in use`,
                );
            });

            it("Cannot Close Proposal without Owner", async function () {
                const ix = await engine.closeProposalIx({ owner: ownerAssistant.publicKey });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Close Proposal as Owner", async function () {
                const ix = await engine.closeProposalIx({ owner: owner.publicKey });

                await expectIxOk(connection, [ix], [owner]);
            });
        });

        describe("Update Auction Parameters", async function () {
            const localVariables = new Map<string, any>();

            // Create a new set of auction parameters.
            const newAuctionParameters: AuctionParameters = {
                userPenaltyRewardBps: 300000, // 30%
                initialPenaltyBps: 200000, // 20%
                duration: 3,
                gracePeriod: 4,
                penaltyPeriod: 8,
                minOfferDeltaBps: 50000, // 5%
            };

            before("Propose New Auction Parameters as Owner Assistant", async function () {
                const { nextProposalId } = await engine.fetchCustodian();

                localVariables.set("duplicateProposalId", nextProposalId);

                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    newAuctionParameters,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);
            });

            it("Cannot Update Auction Config (Owner Only)", async function () {
                const proposalId = localVariables.get("duplicateProposalId") as BN;
                const proposal = await engine.proposalAddress(proposalId);

                const ix = await engine.updateAuctionParametersIx({
                    owner: ownerAssistant.publicKey,
                    proposal,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Cannot Update Auction Config (Proposal Delay Not Expired)", async function () {
                const proposalId = localVariables.get("duplicateProposalId") as BN;
                const proposal = await engine.proposalAddress(proposalId);

                const ix = await engine.updateAuctionParametersIx({
                    owner: owner.publicKey,
                    proposal,
                });

                await expectIxErr(connection, [ix], [owner], "Error Code: ProposalDelayNotExpired");
            });

            it("Update Auction Config as Owner", async function () {
                const { auctionConfigId } = await engine.fetchCustodian();

                // Subtract one to get the proposal ID for the auction parameters proposal.
                const proposalId = localVariables.get("duplicateProposalId") as BN;
                const proposal = await engine.proposalAddress(proposalId);
                const proposalDataBefore = await engine.fetchProposal({ address: proposal });

                await waitUntilSlot(
                    connection,
                    proposalDataBefore.slotEnactDelay.toNumber() + SLOTS_PER_EPOCH + 1,
                );

                const ix = await engine.updateAuctionParametersIx({
                    owner: owner.publicKey,
                    proposal,
                });

                await expectIxOk(connection, [ix], [owner]);

                const auctionConfigData = await engine.fetchAuctionConfig(auctionConfigId + 1);
                expect(auctionConfigData).to.eql(
                    new AuctionConfig(auctionConfigId + 1, newAuctionParameters),
                );

                // Verify that the proposal was updated with the enacted at slot.
                const proposalDataAfter = await engine
                    .proposalAddress(proposalId)
                    .then((addr) => engine.fetchProposal({ address: addr }));
                expect(proposalDataAfter.slotEnactedAt).to.eql(
                    numberToU64BN(await connection.getSlot()),
                );
            });

            it("Cannot Update Auction Config (Proposal Already Enacted)", async function () {
                const proposalId = localVariables.get("duplicateProposalId") as BN;
                const proposal = await engine.proposalAddress(proposalId);

                const ix = await engine.updateAuctionParametersIx({
                    owner: owner.publicKey,
                    proposal,
                });

                await expectIxErr(connection, [ix], [owner], "Error Code: ProposalAlreadyEnacted");
            });
        });
    });

    describe("Business Logic", function () {
        const baseFastOrder: FastMarketOrder = {
            amountIn: 50000000000n,
            minAmountOut: 0n,
            targetChain: arbChain,
            redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
            sender: Array.from(Buffer.alloc(32, "beefdead", "hex")),
            refundAddress: Array.from(Buffer.alloc(32, "beef", "hex")),
            maxFee: 1000000n,
            initAuctionFee: 100n,
            deadline: 0,
            redeemerMessage: Buffer.from("All your base are belong to us."),
        };

        describe("Place Initial Offer", function () {
            for (const offerPrice of [0n, baseFastOrder.maxFee / 2n, baseFastOrder.maxFee]) {
                it(`Place Initial Offer (Price == ${offerPrice})`, async function () {
                    const { fastVaa, txDetails, auction } = await placeInitialOfferForTest(
                        playerOne,
                        baseFastOrder,
                        ethRouter,
                        offerPrice,
                    );
                });
            }

            it("Place Initial Offer (Offer == Max Fee; Max Fee == Amount Minus 1)", async function () {
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;
                fastOrder.maxFee = fastOrder.amountIn - 1n;

                await placeInitialOfferForTest(playerOne, fastOrder, ethRouter, fastOrder.maxFee);
            });

            it("Place Initial Offer (With Deadline)", async function () {
                const fastOrder = { ...baseFastOrder } as FastMarketOrder;
                const { maxFee: offerPrice } = fastOrder;

                // Set the deadline to 10 slots from now.
                const currTime = await connection.getBlockTime(await connection.getSlot());
                if (currTime === null) {
                    throw new Error("Failed to get current block time");
                }
                fastOrder.deadline = currTime + 10;

                await placeInitialOfferForTest(playerOne, fastOrder, ethRouter, offerPrice);
            });

            it("Cannot Place Initial Offer (Invalid VAA)", async function () {
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    playerOne,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    Buffer.from("deadbeef", "hex"),
                );

                const auction = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    engine.auctionAddress(vaa.digest()),
                );

                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        auction,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                        totalDeposit: baseFastOrder.amountIn + baseFastOrder.maxFee,
                    },
                    baseFastOrder.maxFee,
                );
                await expectIxErr(connection, [approveIx, ix], [playerOne], "InvalidVaa");
            });

            it("Cannot Place Initial Offer (Invalid Payload)", async function () {
                const message = new LiquidityLayerMessage({
                    fastFill: {
                        amount: 1000n,
                        fill: {
                            sourceChain: ethChain,
                            orderSender: Array.from(baseFastOrder.sender),
                            redeemer: Array.from(baseFastOrder.redeemer),
                            redeemerMessage: baseFastOrder.redeemerMessage,
                        },
                    },
                });

                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    playerOne,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    message,
                );

                const auction = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    engine.auctionAddress(vaa.digest()),
                );

                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        auction,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                        totalDeposit: baseFastOrder.amountIn + baseFastOrder.maxFee,
                    },
                    baseFastOrder.maxFee,
                );
                await expectIxErr(connection, [approveIx, ix], [playerOne], "NotFastMarketOrder");
            });

            it("Cannot Place Initial Offer (Deadline Exceeded)", async function () {
                const fastMarketOrder = { ...baseFastOrder } as FastMarketOrder;

                // Set the deadline to the previous block timestamp.
                fastMarketOrder.deadline = await connection
                    .getSlot()
                    .then((slot) => connection.getBlockTime(slot))
                    .then((blockTime) => blockTime! - 1);

                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    playerOne,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder }),
                );

                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                    },
                    fastMarketOrder.maxFee,
                );

                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "FastMarketOrderExpired",
                );
            });

            it("Cannot Place Initial Offer (Offer Price Too High)", async function () {
                const offerPrice = baseFastOrder.maxFee + 1n;

                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    playerOne,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder: baseFastOrder }),
                );

                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                    },
                    offerPrice,
                );
                await expectIxErr(connection, [approveIx, ix], [playerOne], "OfferPriceTooHigh");
            });

            it("Cannot Place Initial Offer (Invalid Emitter Chain)", async function () {
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder: baseFastOrder }),
                    "acala",
                );

                const { maxFee: offerPrice } = baseFastOrder;
                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                    },
                    offerPrice,
                );
                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "ErrInvalidSourceRouter",
                );
            });

            it("Cannot Place Initial Offer (Invalid Emitter Address)", async function () {
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    arbRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder: baseFastOrder }),
                );

                const { maxFee: offerPrice } = baseFastOrder;
                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                    },
                    offerPrice,
                );
                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "ErrInvalidSourceRouter",
                );
            });

            it("Cannot Place Initial Offer (Invalid Target Router Chain)", async function () {
                // Change the fast order chain Id.
                const fastMarketOrder = { ...baseFastOrder } as FastMarketOrder;
                fastMarketOrder.targetChain = wormholeSdk.CHAINS.acala;

                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder }),
                );

                const { maxFee: offerPrice } = fastMarketOrder;
                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                    },
                    offerPrice,
                );
                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "ErrInvalidTargetRouter",
                );
            });

            it("Cannot Place Initial Offer Again", async function () {
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({ fastMarketOrder: baseFastOrder }),
                );

                const { maxFee: offerPrice } = baseFastOrder;
                const [approveIx, ix] = await engine.placeInitialOfferIx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                    },
                    offerPrice,
                );
                await expectIxOk(connection, [approveIx, ix], [playerOne]);

                // TODO: find specific address already in use
                await expectIxErr(connection, [approveIx, ix], [playerOne], "already in use");
            });

            before("Register To Router Endpoints", async function () {
                const ix = await engine.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    {
                        chain: arbChain,
                        cctpDomain: arbDomain,
                        address: arbRouter,
                        mintRecipient: null,
                    },
                );
                await expectIxOk(connection, [ix], [owner]);
            });

            before("Create ATAs For Offer Authorities", async function () {
                for (const wallet of [playerOne, playerTwo, liquidator]) {
                    const destination = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        wallet.publicKey,
                    );
                    const createIx = splToken.createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        destination,
                        wallet.publicKey,
                        USDC_MINT_ADDRESS,
                    );

                    const mintAmount = 10_000_000n * 1_000_000n;
                    const mintIx = splToken.createMintToInstruction(
                        USDC_MINT_ADDRESS,
                        destination,
                        payer.publicKey,
                        mintAmount,
                    );
                    await expectIxOk(connection, [createIx, mintIx], [payer]);

                    const { amount } = await splToken.getAccount(connection, destination);
                    expect(amount).equals(mintAmount);
                }
            });
        });

        describe("Improve Offer", function () {
            for (const newOffer of [0n, baseFastOrder.maxFee / 2n]) {
                it(`Improve Offer (Price == ${newOffer})`, async function () {
                    const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                        playerOne,
                        baseFastOrder,
                        ethRouter,
                    );

                    const initialOfferBalanceBefore = await getUsdcAtaBalance(
                        connection,
                        playerOne.publicKey,
                    );
                    const newOfferBalanceBefore = await getUsdcAtaBalance(
                        connection,
                        playerTwo.publicKey,
                    );
                    const { amount: custodyBalanceBefore } = await engine.fetchCctpMintRecipient();

                    const [approveIx, ix] = await engine.improveOfferIx(
                        {
                            auction,
                            participant: playerTwo.publicKey,
                        },
                        newOffer,
                    );

                    await expectIxOk(connection, [approveIx, ix], [playerTwo]);

                    await checkAfterEffects(
                        auction,
                        playerTwo.publicKey,
                        newOffer,
                        auctionDataBefore,
                        {
                            custodyToken: custodyBalanceBefore,
                            bestOfferToken: newOfferBalanceBefore,
                            prevBestOfferToken: initialOfferBalanceBefore,
                        },
                    );
                });
            }

            it("Improve Offer By Min Offer Delta", async function () {
                const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const currentOffer = BigInt(auctionDataBefore.info!.offerPrice.toString());
                const newOffer =
                    currentOffer - (await engine.computeMinOfferDelta(currentOffer)) - 100n;

                const initialOfferBalanceBefore = await getUsdcAtaBalance(
                    connection,
                    playerOne.publicKey,
                );
                const newOfferBalanceBefore = await getUsdcAtaBalance(
                    connection,
                    playerTwo.publicKey,
                );
                const { amount: custodyBalanceBefore } = await engine.fetchCctpMintRecipient();

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerTwo.publicKey,
                    },
                    newOffer,
                );

                await expectIxOk(connection, [approveIx, ix], [playerTwo]);

                await checkAfterEffects(auction, playerTwo.publicKey, newOffer, auctionDataBefore, {
                    custodyToken: custodyBalanceBefore,
                    bestOfferToken: newOfferBalanceBefore,
                    prevBestOfferToken: initialOfferBalanceBefore,
                });
            });

            it("Improve Offer With Same Best Offer Token Account", async function () {
                const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const initialOfferBalanceBefore = await getUsdcAtaBalance(
                    connection,
                    playerOne.publicKey,
                );
                const { amount: custodyBalanceBefore } = await engine.fetchCctpMintRecipient();

                // New Offer from playerOne.
                const currentOffer = BigInt(auctionDataBefore.info!.offerPrice.toString());
                const newOffer = currentOffer - (await engine.computeMinOfferDelta(currentOffer));

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerOne.publicKey,
                    },
                    newOffer,
                );

                await expectIxOk(connection, [approveIx, ix], [playerOne]);

                await checkAfterEffects(auction, playerOne.publicKey, newOffer, auctionDataBefore, {
                    custodyToken: custodyBalanceBefore,
                    bestOfferToken: initialOfferBalanceBefore,
                });
            });

            it("Cannot Improve Offer (Auction Expired)", async function () {
                const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const { startSlot, offerPrice } = auctionDataBefore.info!;
                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                // New Offer from playerOne.
                const newOffer = BigInt(offerPrice.subn(100).toString());

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerOne.publicKey,
                    },
                    newOffer,
                );

                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "Error Code: AuctionPeriodExpired",
                );
            });

            it("Cannot Improve Offer (Invalid Best Offer Token Account)", async function () {
                const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                // New Offer from playerOne.
                const newOffer = BigInt(auctionDataBefore.info!.offerPrice.subn(100).toString());

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerOne.publicKey,
                        bestOfferToken: engine.cctpMintRecipientAddress(),
                    },
                    newOffer,
                );
                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "best_offer_token. Error Code: ConstraintAddress",
                );
            });

            it("Cannot Improve Offer (Carping Not Allowed)", async function () {
                const { auction, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                // Attempt to improve by the minimum allowed.
                const newOffer = BigInt(auctionDataBefore.info!.offerPrice.toString()) - 1n;
                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerTwo.publicKey,
                    },
                    newOffer,
                );

                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerTwo],
                    "Error Code: CarpingNotAllowed",
                );
            });

            async function checkAfterEffects(
                auction: PublicKey,
                newOfferAuthority: PublicKey,
                offerPrice: bigint,
                auctionDataBefore: Auction,
                balancesBefore: {
                    custodyToken: bigint;
                    bestOfferToken: bigint;
                    prevBestOfferToken?: bigint;
                },
            ) {
                const {
                    custodyToken: custodyTokenBefore,
                    bestOfferToken: bestOfferTokenBefore,
                    prevBestOfferToken: prevBestOfferTokenBefore,
                } = balancesBefore;

                const bestOfferToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    newOfferAuthority,
                );

                const { bump, vaaHash, status, info } = auctionDataBefore;
                const {
                    configId,
                    custodyTokenBump,
                    vaaSequence,
                    bestOfferToken: prevBestOfferToken,
                    initialOfferToken,
                    startSlot,
                    amountIn,
                    securityDeposit,
                    offerPrice: prevOfferPrice,
                    amountOut,
                    sourceChain,
                } = info!;
                expect(offerPrice).not.equals(BigInt(prevOfferPrice.toString()));

                const auctionDataAfter = await engine.fetchAuction({ address: auction });
                expect(auctionDataAfter).to.eql(
                    new Auction(bump, vaaHash, status, {
                        configId,
                        custodyTokenBump,
                        vaaSequence,
                        sourceChain,
                        bestOfferToken,
                        initialOfferToken,
                        startSlot,
                        amountIn,
                        securityDeposit,
                        offerPrice: bigintToU64BN(offerPrice),
                        amountOut,
                    }),
                );

                // Custody token should be unchanged.
                const { amount: custodyTokenAfter } = await engine.fetchCctpMintRecipient();
                expect(custodyTokenAfter).equals(custodyTokenBefore);

                const balanceChange = BigInt(amountIn.add(securityDeposit).toString());

                if (prevBestOfferTokenBefore !== undefined) {
                    expect(bestOfferToken).to.not.eql(prevBestOfferToken);

                    // New offer change.
                    const { amount: bestOfferTokenAfter } = await splToken.getAccount(
                        connection,
                        bestOfferToken,
                    );
                    expect(bestOfferTokenAfter).equals(bestOfferTokenBefore - balanceChange);

                    // Previous offer refunded.
                    const { amount: prevBestOfferTokenAfter } = await splToken.getAccount(
                        connection,
                        prevBestOfferToken,
                    );
                    expect(prevBestOfferTokenAfter).equals(
                        prevBestOfferTokenBefore + balanceChange,
                    );
                } else {
                    expect(bestOfferToken).to.eql(prevBestOfferToken);

                    // Should be no change.
                    const { amount: bestOfferTokenAfter } = await splToken.getAccount(
                        connection,
                        bestOfferToken,
                    );
                    expect(bestOfferTokenAfter).equals(bestOfferTokenBefore);
                }
            }
        });

        describe("Execute Fast Order", function () {
            const localVariables = new Map<string, any>();

            it("Execute Fast Order Within Grace Period", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const {
                    fastVaa,
                    auction,
                    auctionDataBefore: initialData,
                } = await placeInitialOfferForTest(playerTwo, baseFastOrder, ethRouter);

                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    playerOne,
                    improveBy,
                );
                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const { amount: bestOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    bestOfferToken,
                );
                const { amount: initialOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    initialOfferToken,
                );
                const custodyTokenBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const txDetails = await expectIxOkDetails(connection, [computeIx, ix], [playerOne]);

                await checkAfterEffects(
                    txDetails!,
                    auction,
                    auctionDataBefore,
                    {
                        custodyToken: custodyTokenBefore,
                        bestOfferToken: bestOfferTokenBefore,
                        initialOfferToken: initialOfferTokenBefore,
                    },
                    playerOne.publicKey,
                    false, // hasPenalty
                    "ethereum",
                    "arbitrum",
                );

                localVariables.set("auction", auction);
            });

            it("Reclaim by Closing CCTP Message", async function () {
                const currentSequence = await engine.fetchPayerSequenceValue(playerOne.publicKey);
                const cctpMessage = engine.cctpMessageAddress(
                    playerOne.publicKey,
                    currentSequence - 1n,
                );

                const messageTransmitter = engine.messageTransmitterProgram();
                const { message } = await messageTransmitter.fetchMessageSent(cctpMessage);

                // Simulate attestation.
                const cctpAttestation = new CircleAttester().createAttestation(message);

                const ix = await engine.reclaimCctpMessageIx(
                    {
                        payer: playerOne.publicKey,
                        cctpMessage,
                    },
                    cctpAttestation,
                );

                const balanceBefore = await connection.getBalance(playerOne.publicKey);

                await expectIxOk(connection, [ix], [playerOne]);

                const balanceAfter = await connection.getBalance(playerOne.publicKey);
                expect(balanceAfter - balanceBefore).equals(2918200);
            });

            it("Cannot Improve Offer After Execute Order", async function () {
                const auction = localVariables.get("auction") as PublicKey;
                expect(localVariables.delete("auction")).is.true;

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        participant: playerOne.publicKey,
                        auction,
                    },
                    baseFastOrder.maxFee,
                );

                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "custody_token. Error Code: AccountNotInitialized",
                );
            });

            it("Execute Fast Order After Grace Period", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const {
                    fastVaa,
                    auction,
                    auctionDataBefore: initialData,
                } = await placeInitialOfferForTest(playerTwo, baseFastOrder, ethRouter);

                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    playerOne,
                    improveBy,
                );
                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const { amount: bestOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    bestOfferToken,
                );
                const { amount: initialOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    initialOfferToken,
                );
                const custodyTokenBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

                const { duration, gracePeriod, penaltyPeriod } =
                    await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore
                        .info!.startSlot.addn(duration + gracePeriod + penaltyPeriod / 2)
                        .toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const txDetails = await expectIxOkDetails(connection, [computeIx, ix], [playerOne]);

                await checkAfterEffects(
                    txDetails!,
                    auction,
                    auctionDataBefore,
                    {
                        custodyToken: custodyTokenBefore,
                        bestOfferToken: bestOfferTokenBefore,
                        initialOfferToken: initialOfferTokenBefore,
                    },
                    playerOne.publicKey,
                    true, // hasPenalty
                    "ethereum",
                    "arbitrum",
                );
            });

            it("Execute Fast Order After Grace Period with Liquidator", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const {
                    fastVaa,
                    auction,
                    auctionDataBefore: initialData,
                } = await placeInitialOfferForTest(playerTwo, baseFastOrder, ethRouter);

                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    playerOne,
                    improveBy,
                );
                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const { amount: bestOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    bestOfferToken,
                );
                const { amount: initialOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    initialOfferToken,
                );
                const custodyTokenBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

                const liquidatorToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    liquidator.publicKey,
                );
                const { amount: executorTokenBefore } = await splToken.getAccount(
                    connection,
                    liquidatorToken,
                );

                const { duration, gracePeriod, penaltyPeriod } =
                    await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore
                        .info!.startSlot.addn(duration + gracePeriod + penaltyPeriod / 2)
                        .toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: liquidator.publicKey,
                    fastVaa,
                });

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                const txDetails = await expectIxOkDetails(
                    connection,
                    [computeIx, ix],
                    [liquidator],
                    { addressLookupTableAccounts: [lookupTableAccount!] },
                );

                await checkAfterEffects(
                    txDetails!,
                    auction,
                    auctionDataBefore,
                    {
                        custodyToken: custodyTokenBefore,
                        bestOfferToken: bestOfferTokenBefore,
                        initialOfferToken: initialOfferTokenBefore,
                        executorToken: executorTokenBefore,
                    },
                    liquidator.publicKey,
                    true, // hasPenalty
                    "ethereum",
                    "arbitrum",
                );
            });

            it("Execute Fast Order After Penalty Period with Liquidator", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const {
                    fastVaa,
                    auction,
                    auctionDataBefore: initialData,
                } = await placeInitialOfferForTest(playerTwo, baseFastOrder, ethRouter);

                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    playerOne,
                    improveBy,
                );
                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const { amount: bestOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    bestOfferToken,
                );
                const { amount: initialOfferTokenBefore } = await splToken.getAccount(
                    connection,
                    initialOfferToken,
                );
                const custodyTokenBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

                const liquidatorToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    liquidator.publicKey,
                );
                const { amount: executorTokenBefore } = await splToken.getAccount(
                    connection,
                    liquidatorToken,
                );

                const { duration, gracePeriod, penaltyPeriod } =
                    await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore
                        .info!.startSlot.addn(duration + gracePeriod + penaltyPeriod + 2)
                        .toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: liquidator.publicKey,
                    fastVaa,
                });

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                const txDetails = await expectIxOkDetails(
                    connection,
                    [computeIx, ix],
                    [liquidator],
                    { addressLookupTableAccounts: [lookupTableAccount!] },
                );

                await checkAfterEffects(
                    txDetails!,
                    auction,
                    auctionDataBefore,
                    {
                        custodyToken: custodyTokenBefore,
                        bestOfferToken: bestOfferTokenBefore,
                        initialOfferToken: initialOfferTokenBefore,
                        executorToken: executorTokenBefore,
                    },
                    liquidator.publicKey,
                    true, // hasPenalty
                    "ethereum",
                    "arbitrum",
                );
            });

            // Cannot perform this test w/o solana endpoint.
            it.skip("Cannot Execute Fast Order (Invalid Chain)", async function () {
                const fastOrder = { ...baseFastOrder };
                fastOrder.targetChain = ethChain;

                const { fastVaa, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    fastOrder,
                    ethRouter,
                );

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 2).toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });
                await expectIxErr(connection, [ix], [playerOne], "Error Code: InvalidChain");
            });

            it("Cannot Execute Fast Order with VAA Hash Mismatch", async function () {
                const { fastVaaAccount, auction, auctionDataBefore } =
                    await placeInitialOfferForTest(
                        playerOne,
                        baseFastOrder,
                        ethRouter,
                        baseFastOrder.maxFee,
                    );

                const { fastVaa: anotherFastVaa, fastVaaAccount: anotherFastVaaAccount } =
                    await placeInitialOfferForTest(
                        playerOne,
                        baseFastOrder,
                        ethRouter,
                        baseFastOrder.maxFee,
                    );
                expect(fastVaaAccount.digest()).to.not.eql(anotherFastVaaAccount.digest());

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 2).toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa: anotherFastVaa,
                    auction,
                });

                await expectIxErr(connection, [ix], [playerOne], "Error Code: InvalidVaa");
            });

            it("Cannot Execute Fast Order (Invalid Best Offer Token Account)", async function () {
                const { fastVaa, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const bogusToken = engine.cctpMintRecipientAddress();

                const { bestOfferToken } = auctionDataBefore.info!;
                expect(bogusToken).to.not.eql(bestOfferToken);

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                    bestOfferToken: bogusToken,
                });

                // Pass the wrong address for the best offer token account.
                await expectIxErr(
                    connection,
                    [ix],
                    [playerOne],
                    "best_offer_token. Error Code: ConstraintAddress",
                );
            });

            it("Cannot Execute Fast Order (Invalid Initial Offer Token Account)", async function () {
                const { fastVaa, auctionDataBefore } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const bogusToken = engine.cctpMintRecipientAddress();

                const { initialOfferToken } = auctionDataBefore.info!;
                expect(bogusToken).to.not.eql(initialOfferToken);

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                    initialOfferToken: bogusToken,
                });

                // Pass the wrong address for the best offer token account.
                await expectIxErr(
                    connection,
                    [ix],
                    [playerOne],
                    "initial_offer_token. Error Code: ConstraintAddress",
                );
            });

            it("Execute Fast Order", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const { fastVaa, auctionDataBefore } = await placeInitialOfferForTest(
                    playerTwo,
                    baseFastOrder,
                    ethRouter,
                );

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                await expectIxOk(connection, [ix], [playerOne]);

                localVariables.set("ix", ix);
            });

            it("Cannot Execute Fast Order on Auction Completed", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                await expectIxErr(
                    connection,
                    [ix],
                    [playerOne],
                    "custody_token. Error Code: AccountNotInitialized",
                );
            });

            it("Cannot Execute Fast Order (Auction Period Not Expired)", async function () {
                const { fastVaa } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [playerOne],
                    "Error Code: AuctionPeriodNotExpired",
                );
            });

            it("Cannot Execute Fast Order Solana (Invalid Chain)", async function () {
                const { fastVaa, fastVaaAccount } = await placeInitialOfferForTest(
                    playerOne,
                    baseFastOrder,
                    ethRouter,
                );

                await expectIxErr(
                    connection,
                    [
                        await engine.executeFastOrderLocalIx({
                            payer: playerOne.publicKey,
                            fastVaa,
                            toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                        }),
                    ],
                    [playerOne],
                    "Error Code: InvalidEndpoint",
                );
            });

            async function checkAfterEffects(
                txDetails: VersionedTransactionResponse,
                auction: PublicKey,
                auctionDataBefore: Auction,
                balancesBefore: {
                    custodyToken: bigint;
                    bestOfferToken: bigint;
                    initialOfferToken: bigint;
                    executorToken?: bigint;
                },
                executor: PublicKey,
                hasPenalty: boolean,
                fromChainName: wormholeSdk.ChainName,
                toChainName: wormholeSdk.ChainName,
            ) {
                const {
                    custodyToken: custodyTokenBefore,
                    bestOfferToken: bestOfferTokenBefore,
                    initialOfferToken: initialOfferTokenBefore,
                    executorToken: executorTokenBefore,
                } = balancesBefore;

                const { bump, vaaHash, info } = auctionDataBefore;

                const auctionDataAfter = await engine.fetchAuction({ address: auction });

                const { bestOfferToken, initialOfferToken, securityDeposit, amountIn, offerPrice } =
                    info!;

                // Validate balance changes.
                const { amount: bestOfferTokenAfter } = await splToken.getAccount(
                    connection,
                    bestOfferToken,
                );
                const { amount: initialOfferTokenAfter } = await splToken.getAccount(
                    connection,
                    initialOfferToken,
                );

                const { penalty, userReward } = await engine.computeDepositPenalty(
                    info!,
                    BigInt(txDetails.slot),
                    info!.configId,
                );

                const {
                    targetChain,
                    initAuctionFee,
                    sender: orderSender,
                    redeemer,
                    redeemerMessage,
                } = baseFastOrder;

                if (hasPenalty) {
                    expect(penalty > 0n).is.true;
                    expect(userReward > 0n).is.true;

                    expect(auctionDataAfter).to.eql(
                        new Auction(
                            bump,
                            vaaHash,
                            {
                                completed: {
                                    slot: bigintToU64BN(BigInt(txDetails.slot)),
                                    executePenalty: bigintToU64BN(penalty),
                                },
                            },
                            info,
                        ),
                    );

                    let depositAndFee =
                        BigInt(offerPrice.add(securityDeposit).toString()) - userReward;
                    const executorToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        executor,
                    );
                    if (!executorToken.equals(bestOfferToken)) {
                        depositAndFee -= penalty;

                        const { amount: executorTokenAfter } = await splToken.getAccount(
                            connection,
                            executorToken,
                        );
                        expect(executorTokenAfter).equals(executorTokenBefore! + penalty);
                    }

                    if (bestOfferToken.equals(initialOfferToken)) {
                        expect(bestOfferTokenAfter).equals(
                            bestOfferTokenBefore + depositAndFee + initAuctionFee,
                        );
                    } else {
                        expect(bestOfferTokenAfter).equals(bestOfferTokenBefore + depositAndFee);
                        expect(initialOfferTokenAfter).equals(
                            initialOfferTokenBefore + initAuctionFee,
                        );
                    }
                } else {
                    expect(penalty).equals(0n);
                    expect(userReward).equals(0n);

                    expect(auctionDataAfter).to.eql(
                        new Auction(
                            bump,
                            vaaHash,
                            {
                                completed: {
                                    slot: bigintToU64BN(BigInt(txDetails.slot)),
                                    executePenalty: null,
                                },
                            },
                            info,
                        ),
                    );

                    const depositAndFee = BigInt(offerPrice.add(securityDeposit).toString());

                    if (bestOfferToken.equals(initialOfferToken)) {
                        expect(bestOfferTokenAfter).equals(
                            bestOfferTokenBefore + depositAndFee + initAuctionFee,
                        );
                    } else {
                        expect(bestOfferTokenAfter).equals(bestOfferTokenBefore + depositAndFee);
                        expect(initialOfferTokenAfter).equals(
                            initialOfferTokenBefore + initAuctionFee,
                        );
                    }
                }

                const custodyTokenAfter = await engine.fetchAuctionCustodyTokenBalance(auction);
                expect(custodyTokenAfter).equals(0n);

                // Validate the core message.
                const message = await engine.getCoreMessage(executor);
                const {
                    message: { payload },
                } = await getPostedMessage(connection, message);
                const parsed = LiquidityLayerMessage.decode(payload);
                expect(parsed.deposit?.message.fill).is.not.undefined;

                const {
                    protocol: { cctp },
                } = await engine.fetchRouterEndpoint(targetChain);
                expect(cctp).is.not.undefined;

                const {
                    header: { amount: actualAmount, destinationCctpDomain, mintRecipient },
                    message: { fill },
                } = parsed.deposit!;

                const userAmount =
                    BigInt(amountIn.sub(offerPrice).toString()) - initAuctionFee + userReward;
                expect(actualAmount).equals(userAmount);
                expect(destinationCctpDomain).equals(cctp!.domain);

                const sourceChain = wormholeSdk.coalesceChainId(fromChainName);
                const { mintRecipient: expectedMintRecipient } = await engine.fetchRouterEndpoint(
                    wormholeSdk.coalesceChainId(toChainName),
                );
                expect(mintRecipient).to.eql(expectedMintRecipient);

                const expectedFill: Fill = {
                    sourceChain,
                    orderSender,
                    redeemer,
                    redeemerMessage,
                };
                expect(fill).to.eql(expectedFill);
            }
        });

        describe("Prepare Order Response", function () {
            const localVariables = new Map<string, any>();

            // TODO: add negative tests
            it("Cannot Prepare Order Response with Emitter Chain Mismatch", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

                const fastMessage = new LiquidityLayerMessage({
                    fastMarketOrder: {
                        amountIn,
                        minAmountOut: 0n,
                        targetChain: wormholeSdk.CHAIN_ID_SOLANA as number,
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
                            mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        },
                    ),
                });

                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage,
                );
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    fastMessage,
                    "arbitrum",
                );

                const ix = await engine.prepareOrderResponseCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(connection, [computeIx, ix], [payer], "Error Code: VaaMismatch", {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });
            });

            it("Cannot Prepare Order Response with Emitter Address Mismatch", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

                const fastMessage = new LiquidityLayerMessage({
                    fastMarketOrder: {
                        amountIn,
                        minAmountOut: 0n,
                        targetChain: wormholeSdk.CHAIN_ID_SOLANA as number,
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
                            mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        },
                    ),
                });

                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage,
                );
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    arbRouter,
                    wormholeSequence++,
                    fastMessage,
                );

                const ix = await engine.prepareOrderResponseCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(connection, [computeIx, ix], [payer], "Error Code: VaaMismatch", {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });
            });

            it("Cannot Prepare Order Response with Emitter Sequence Mismatch", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

                const fastMessage = new LiquidityLayerMessage({
                    fastMarketOrder: {
                        amountIn,
                        minAmountOut: 0n,
                        targetChain: wormholeSdk.CHAIN_ID_SOLANA as number,
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
                            mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        },
                    ),
                });

                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage,
                );
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence + 2n,
                    fastMessage,
                );

                const ix = await engine.prepareOrderResponseCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(connection, [computeIx, ix], [payer], "Error Code: VaaMismatch", {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });
            });

            // TODO: Test timestamp mismatch
            it.skip("Cannot Prepare Order Response with VAA Timestamp Mismatch", async function () {});

            it("Prepare Order Response", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

                const fastMessage = new LiquidityLayerMessage({
                    fastMarketOrder: {
                        amountIn,
                        minAmountOut: 0n,
                        targetChain: wormholeSdk.CHAIN_ID_SOLANA as number,
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
                            mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        },
                    ),
                });

                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage,
                );
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    fastMessage,
                );

                const ix = await engine.prepareOrderResponseCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [computeIx, ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                // TODO: validate prepared slow order
                const fastVaaHash = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    vaa.digest(),
                );
                const preparedOrderResponse = engine.preparedOrderResponseAddress(fastVaaHash);

                const preparedOrderResponseData = await engine.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });
                const { bump } = preparedOrderResponseData;

                expect(preparedOrderResponseData).to.eql({
                    bump,
                    preparedBy: payer.publicKey,
                    fastVaaHash: Array.from(fastVaaHash),
                    sourceChain: ethChain,
                    baseFee: bigintToU64BN(
                        finalizedMessage.deposit!.message.slowOrderResponse!.baseFee,
                    ),
                });

                const { amount: preparedCustodyBalance } = await splToken.getAccount(
                    connection,
                    engine.preparedCustodyTokenAddress(preparedOrderResponse),
                );
                expect(preparedCustodyBalance).equals(fastMessage.fastMarketOrder!.amountIn);

                const { amount: cctpMintRecipientBalance } = await splToken.getAccount(
                    connection,
                    engine.cctpMintRecipientAddress(),
                );
                expect(cctpMintRecipientBalance).equals(0n);

                // Save for later.
                localVariables.set("ix", ix);
                localVariables.set("preparedOrderResponse", preparedOrderResponse);
            });

            it("Prepare Order Response for Same VAAs is No-op", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                const preparedOrderResponse = localVariables.get(
                    "preparedOrderResponse",
                ) as PublicKey;
                expect(localVariables.delete("preparedOrderResponse")).is.true;

                const preparedOrderResponseDataBefore = await engine.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                const preparedOrderResponseDataAfter = await engine.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });
                expect(preparedOrderResponseDataAfter).to.eql(preparedOrderResponseDataBefore);
            });

            it("Prepare Order Response for Active Auction", async function () {
                const redeemer = Keypair.generate();

                const sourceCctpDomain = 0;
                const cctpNonce = testCctpNonce++;
                const amountIn = 690000n; // 69 cents

                // Concoct a Circle message.
                const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

                const fastMarketOrder = {
                    amountIn,
                    minAmountOut: 0n,
                    targetChain: arbChain,
                    redeemer: Array.from(redeemer.publicKey.toBuffer()),
                    sender: new Array(32).fill(0),
                    refundAddress: new Array(32).fill(0),
                    maxFee: 42069n,
                    initAuctionFee: 2000n,
                    deadline: 0,
                    redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                };

                const finalizedMessage = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit(
                        {
                            tokenAddress: burnMessage.burnTokenAddress,
                            amount: amountIn,
                            sourceCctpDomain,
                            destinationCctpDomain,
                            cctpNonce,
                            burnSource,
                            mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                        },
                        {
                            slowOrderResponse: {
                                baseFee: 420n,
                            },
                        },
                    ),
                });

                const finalizedVaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    finalizedMessage,
                );

                const { fastVaa, auction } = await placeInitialOfferForTest(
                    playerOne,
                    fastMarketOrder,
                    ethRouter,
                    fastMarketOrder.maxFee,
                );

                const ix = await engine.prepareOrderResponseCctpIx(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                    true, // hasAuction
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [computeIx, ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                // TODO: validate prepared slow order
                const fastVaaHash = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    vaa.digest(),
                );
                const preparedOrderResponse = engine.preparedOrderResponseAddress(fastVaaHash);

                const preparedOrderResponseData = await engine.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });
                const { bump } = preparedOrderResponseData;

                expect(preparedOrderResponseData).to.eql({
                    bump,
                    preparedBy: payer.publicKey,
                    fastVaaHash: Array.from(fastVaaHash),
                    sourceChain: ethChain,
                    baseFee: bigintToU64BN(
                        finalizedMessage.deposit!.message.slowOrderResponse!.baseFee,
                    ),
                });

                const { amount: preparedCustodyBalance } = await splToken.getAccount(
                    connection,
                    engine.preparedCustodyTokenAddress(preparedOrderResponse),
                );
                expect(preparedCustodyBalance).equals(fastMarketOrder.amountIn);

                const { amount: cctpMintRecipientBalance } = await splToken.getAccount(
                    connection,
                    engine.cctpMintRecipientAddress(),
                );
                expect(cctpMintRecipientBalance).equals(0n);
            });
        });

        describe("Settle Auction", function () {
            describe("Auction Complete", function () {
                it("Cannot Settle Active Auction", async function () {
                    const { preparedOrderResponse, auction } = await prepareOrderResponse({
                        initAuction: true,
                        executeOrder: false,
                        prepareOrderResponse: true,
                    });

                    const ix = await engine.settleAuctionCompleteIx({
                        executor: payer.publicKey,
                        preparedOrderResponse,
                        auction,
                    });

                    await expectIxErr(connection, [ix], [payer], "Error Code: AuctionNotCompleted");
                });

                it("Cannot Settle Completed Auction with No Penalty (Executor != Best Offer)", async function () {
                    const { preparedOrderResponse, auction } = await prepareOrderResponse({
                        initAuction: true,
                        executeOrder: true,
                        prepareOrderResponse: true,
                    });
                    const { status: statusBefore } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusBefore.completed!.executePenalty).is.null;

                    const ix = await engine.settleAuctionCompleteIx({
                        executor: payer.publicKey,
                        preparedOrderResponse,
                        auction,
                    });

                    await expectIxErr(
                        connection,
                        [ix],
                        [payer],
                        "Error Code: ExecutorTokenMismatch",
                    );
                });

                it("Settle Completed without Penalty", async function () {
                    const { baseFee, preparedOrderResponse, auction } = await prepareOrderResponse({
                        initAuction: true,
                        executeOrder: true,
                        prepareOrderResponse: true,
                    });

                    const preparedCustodyToken =
                        engine.preparedCustodyTokenAddress(preparedOrderResponse);

                    const { amount: preparedCustodyBalanceBefore } = await splToken.getAccount(
                        connection,
                        preparedCustodyToken,
                    );

                    const { info, status: statusBefore } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusBefore.completed!.executePenalty).is.null;

                    const { bestOfferToken } = info!;
                    const { owner: bestOfferAuthority, amount: bestOfferTokenBalanceBefore } =
                        await splToken.getAccount(connection, bestOfferToken);

                    const authorityLamportsBefore = await connection.getBalance(bestOfferAuthority);

                    const preparedOrderLamports = await connection
                        .getAccountInfo(preparedOrderResponse)
                        .then((info) => info!.lamports);
                    const preparedCustodyLamports = await connection
                        .getAccountInfo(preparedCustodyToken)
                        .then((info) => info!.lamports);

                    const ix = await engine.settleAuctionCompleteIx({
                        executor: bestOfferAuthority,
                        preparedOrderResponse,
                    });

                    await expectIxOk(connection, [ix], [payer]);

                    const preparedCustodyInfo = await connection.getAccountInfo(
                        preparedCustodyToken,
                    );
                    expect(preparedCustodyInfo).is.null;
                    const preparedOrderResponseInfo = await connection.getAccountInfo(
                        preparedOrderResponse,
                    );
                    expect(preparedOrderResponseInfo).is.null;

                    const { amount: bestOfferTokenBalanceAfter } = await splToken.getAccount(
                        connection,
                        bestOfferToken,
                    );
                    expect(bestOfferTokenBalanceAfter).equals(
                        preparedCustodyBalanceBefore + bestOfferTokenBalanceBefore,
                    );

                    const authorityLamportsAfter = await connection.getBalance(bestOfferAuthority);
                    expect(authorityLamportsAfter).equals(
                        authorityLamportsBefore + preparedOrderLamports + preparedCustodyLamports,
                    );

                    const { status: statusAfter } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusAfter).to.eql({
                        settled: {
                            baseFee: bigintToU64BN(baseFee),
                            totalPenalty: null,
                        },
                    });
                });

                it("Settle Completed With Order Response Prepared During Active Auction", async function () {
                    // Prepare the order response, but don't execute the order yet.
                    const { baseFee, preparedOrderResponse, auction, fastVaa } =
                        await prepareOrderResponse({
                            initAuction: true,
                            executeOrder: false,
                            prepareOrderResponse: true,
                        });

                    // Now execute the fast order.
                    {
                        const { info } = await engine.fetchAuction({ address: auction });
                        if (info === null) {
                            throw new Error("No auction info found");
                        }
                        const { configId, bestOfferToken, initialOfferToken, startSlot } = info;
                        const auctionConfig = engine.auctionConfigAddress(configId);
                        const { duration, gracePeriod } = await engine.fetchAuctionParameters(
                            configId,
                        );
                        const endSlot = startSlot.addn(duration + gracePeriod - 1).toNumber();

                        await waitUntilSlot(connection, endSlot);

                        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                            units: 300_000,
                        });
                        const ix = await engine.executeFastOrderCctpIx({
                            payer: payer.publicKey,
                            fastVaa,
                            auction,
                            auctionConfig,
                            bestOfferToken,
                            initialOfferToken,
                        });
                        await expectIxOk(connection, [computeIx, ix], [payer]);
                    }

                    const preparedCustodyToken =
                        engine.preparedCustodyTokenAddress(preparedOrderResponse);

                    const { amount: preparedCustodyBalanceBefore } = await splToken.getAccount(
                        connection,
                        preparedCustodyToken,
                    );

                    const { info, status: statusBefore } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusBefore.completed!.executePenalty).is.null;

                    const { bestOfferToken } = info!;
                    const { owner: bestOfferAuthority, amount: bestOfferTokenBalanceBefore } =
                        await splToken.getAccount(connection, bestOfferToken);

                    const authorityLamportsBefore = await connection.getBalance(bestOfferAuthority);

                    const preparedOrderLamports = await connection
                        .getAccountInfo(preparedOrderResponse)
                        .then((info) => info!.lamports);
                    const preparedCustodyLamports = await connection
                        .getAccountInfo(preparedCustodyToken)
                        .then((info) => info!.lamports);

                    const ix = await engine.settleAuctionCompleteIx({
                        executor: bestOfferAuthority,
                        preparedOrderResponse,
                    });

                    await expectIxOk(connection, [ix], [payer]);

                    const preparedCustodyInfo = await connection.getAccountInfo(
                        preparedCustodyToken,
                    );
                    expect(preparedCustodyInfo).is.null;
                    const preparedOrderResponseInfo = await connection.getAccountInfo(
                        preparedOrderResponse,
                    );
                    expect(preparedOrderResponseInfo).is.null;

                    const { amount: bestOfferTokenBalanceAfter } = await splToken.getAccount(
                        connection,
                        bestOfferToken,
                    );
                    expect(bestOfferTokenBalanceAfter).equals(
                        preparedCustodyBalanceBefore + bestOfferTokenBalanceBefore,
                    );

                    const authorityLamportsAfter = await connection.getBalance(bestOfferAuthority);
                    expect(authorityLamportsAfter).equals(
                        authorityLamportsBefore + preparedOrderLamports + preparedCustodyLamports,
                    );

                    const { status: statusAfter } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusAfter).to.eql({
                        settled: {
                            baseFee: bigintToU64BN(baseFee),
                            totalPenalty: null,
                        },
                    });
                });

                it("Settle Completed with Penalty", async function () {
                    const { baseFee, preparedOrderResponse, auction } = await prepareOrderResponse({
                        initAuction: true,
                        executeOrder: true,
                        prepareOrderResponse: true,
                        executeLate: true,
                    });

                    const preparedCustodyToken =
                        engine.preparedCustodyTokenAddress(preparedOrderResponse);

                    const { amount: preparedCustodyBalanceBefore } = await splToken.getAccount(
                        connection,
                        preparedCustodyToken,
                    );

                    const { info, status: statusBefore } = await engine.fetchAuction({
                        address: auction,
                    });
                    const executePenalty = statusBefore.completed!.executePenalty;
                    expect(executePenalty).is.not.null;

                    const { bestOfferToken } = info!;
                    const { owner: bestOfferAuthority, amount: bestOfferTokenBalanceBefore } =
                        await splToken.getAccount(connection, bestOfferToken);

                    const authorityLamportsBefore = await connection.getBalance(bestOfferAuthority);

                    const preparedOrderLamports = await connection
                        .getAccountInfo(preparedOrderResponse)
                        .then((info) => info!.lamports);
                    const preparedCustodyLamports = await connection
                        .getAccountInfo(preparedCustodyToken)
                        .then((info) => info!.lamports);

                    const ix = await engine.settleAuctionCompleteIx({
                        executor: bestOfferAuthority,
                        preparedOrderResponse,
                    });

                    await expectIxOk(connection, [ix], [payer]);

                    const preparedCustodyInfo = await connection.getAccountInfo(
                        preparedCustodyToken,
                    );
                    expect(preparedCustodyInfo).is.null;
                    const preparedOrderResponseInfo = await connection.getAccountInfo(
                        preparedOrderResponse,
                    );
                    expect(preparedOrderResponseInfo).is.null;

                    const { amount: bestOfferTokenBalanceAfter } = await splToken.getAccount(
                        connection,
                        bestOfferToken,
                    );
                    expect(bestOfferTokenBalanceAfter).equals(
                        preparedCustodyBalanceBefore + bestOfferTokenBalanceBefore,
                    );

                    const authorityLamportsAfter = await connection.getBalance(bestOfferAuthority);
                    expect(authorityLamportsAfter).equals(
                        authorityLamportsBefore + preparedOrderLamports + preparedCustodyLamports,
                    );

                    const { status: statusAfter } = await engine.fetchAuction({
                        address: auction,
                    });
                    expect(statusAfter).to.eql({
                        settled: {
                            baseFee: bigintToU64BN(baseFee),
                            totalPenalty: bigintToU64BN(
                                BigInt(executePenalty!.toString()) + baseFee,
                            ),
                        },
                    });
                });
            });

            describe("Settle No Auction (CCTP)", function () {
                const localVariables = new Map<string, any>();

                it("Settle", async function () {
                    const { fastVaa, fastVaaAccount, finalizedVaaAccount, preparedOrderResponse } =
                        await prepareOrderResponse({
                            initAuction: false,
                            executeOrder: false,
                            prepareOrderResponse: true,
                        });

                    const settleIx = await engine.settleAuctionNoneCctpIx({
                        payer: payer.publicKey,
                        fastVaa,
                        preparedOrderResponse,
                    });

                    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                        units: 300_000,
                    });

                    const { amount: feeBalanceBefore } = await splToken.getAccount(
                        connection,
                        feeRecipientToken,
                    );
                    const preparedCustodyToken =
                        engine.preparedCustodyTokenAddress(preparedOrderResponse);
                    const { amount: custodyBalanceBefore } = await splToken.getAccount(
                        connection,
                        preparedCustodyToken,
                    );

                    await expectIxOk(connection, [computeIx, settleIx], [payer]);

                    const deposit = LiquidityLayerMessage.decode(finalizedVaaAccount.payload())
                        .deposit!;

                    const { baseFee } = deposit.message.slowOrderResponse!;
                    const { amount: feeBalanceAfter } = await splToken.getAccount(
                        connection,
                        feeRecipientToken,
                    );
                    expect(feeBalanceAfter).equals(feeBalanceBefore + baseFee);

                    const { amount: custodyBalanceAfter } = await splToken.getAccount(
                        connection,
                        preparedCustodyToken,
                    );
                    expect(custodyBalanceAfter).equals(
                        custodyBalanceBefore - deposit.header.amount,
                    );

                    const { amount: cctpMintRecipientBalance } =
                        await engine.fetchCctpMintRecipient();
                    expect(cctpMintRecipientBalance).equals(0n);

                    const fastVaaHash = fastVaaAccount.digest();
                    const auctionData = await engine.fetchAuction(fastVaaHash);
                    const { bump, info } = auctionData;
                    expect(info).is.null;

                    expect(auctionData).to.eql(
                        new Auction(
                            bump,
                            Array.from(fastVaaHash),
                            {
                                settled: {
                                    baseFee: bigintToU64BN(baseFee),
                                    totalPenalty: null,
                                },
                            },
                            null,
                        ),
                    );
                });
            });
        });
    });

    async function placeInitialOfferForTest(
        participant: Keypair,
        fastMarketOrder: FastMarketOrder,
        emitter: number[],
        offerPrice?: bigint,
        sourceChain?: wormholeSdk.ChainName,
    ): Promise<{
        fastVaa: PublicKey;
        fastVaaAccount: VaaAccount;
        txDetails: VersionedTransactionResponse;
        auction: PublicKey;
        auctionDataBefore: Auction;
    }> {
        const {
            fast: { vaa: fastVaa, vaaAccount: fastVaaAccount },
        } = await observeCctpOrderVaas({
            sourceChain,
            fastMarketOrder,
        });
        offerPrice = offerPrice ?? fastMarketOrder.maxFee;

        const offerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            participant.publicKey,
        );

        const { amount: offerTokenBalanceBefore } = await splToken.getAccount(
            connection,
            offerToken,
        );

        const auction = engine.auctionAddress(fastVaaAccount.digest());
        const auctionCustodyBalanceBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

        // Place the initial offer.
        const [approveIx, ix] = await engine.placeInitialOfferIx(
            {
                payer: participant.publicKey,
                fastVaa,
            },
            offerPrice,
        );

        const txDetails = await expectIxOkDetails(connection, [approveIx, ix], [participant]);
        if (txDetails === null) {
            throw new Error("Transaction details is null");
        }
        const auctionDataBefore = await engine.fetchAuction({ address: auction });

        // Validate balance changes.
        const { amount: offerTokenBalanceAfter } = await splToken.getAccount(
            connection,
            offerToken,
        );

        const auctionCustodyBalanceAfter = await engine.fetchAuctionCustodyTokenBalance(auction);
        const balanceChange = fastMarketOrder.amountIn + fastMarketOrder.maxFee;

        expect(offerTokenBalanceAfter).equals(offerTokenBalanceBefore - balanceChange);
        expect(auctionCustodyBalanceAfter).equals(auctionCustodyBalanceBefore + balanceChange);

        // Confirm the auction data.
        const vaaHash = fastVaaAccount.digest();
        const auctionData = await engine.fetchAuction(vaaHash);
        const { bump, info } = auctionData;
        const { custodyTokenBump } = info!;

        const { auctionConfigId } = await engine.fetchCustodian();

        expect(fastMarketOrder).is.not.undefined;
        const { amountIn, maxFee } = fastMarketOrder!;

        const expectedAmountIn = bigintToU64BN(amountIn);
        expect(auctionData).to.eql(
            new Auction(
                bump,
                Array.from(vaaHash),
                { active: {} },
                {
                    configId: auctionConfigId,
                    custodyTokenBump,
                    vaaSequence: bigintToU64BN(fastVaaAccount.emitterInfo().sequence),
                    sourceChain: ethChain,
                    bestOfferToken: offerToken,
                    initialOfferToken: offerToken,
                    startSlot: numberToU64BN(txDetails.slot),
                    amountIn: expectedAmountIn,
                    securityDeposit: bigintToU64BN(maxFee),
                    offerPrice: bigintToU64BN(offerPrice),
                    amountOut: expectedAmountIn,
                },
            ),
        );

        return {
            fastVaa,
            fastVaaAccount,
            txDetails,
            auction,
            auctionDataBefore,
        };
    }

    async function improveOfferForTest(
        auction: PublicKey,
        participant: Keypair,
        improveBy: number,
    ) {
        const auctionData = await engine.fetchAuction({ address: auction });
        const newOffer = BigInt(auctionData.info!.offerPrice.subn(improveBy).toString());

        const [approveIx, improveIx] = await engine.improveOfferIx(
            {
                auction,
                participant: participant.publicKey,
            },
            newOffer,
        );

        // Improve the bid with offer one.
        await expectIxOk(connection, [approveIx, improveIx], [participant]);

        const auctionDataBefore = await engine.fetchAuction({ address: auction });
        expect(BigInt(auctionDataBefore.info!.offerPrice.toString())).equals(newOffer);

        return {
            auctionDataBefore,
        };
    }

    async function prepareOrderResponse(args: {
        initAuction: boolean;
        executeOrder: boolean;
        prepareOrderResponse: boolean;
        executeLate?: boolean;
    }) {
        const baseFee = 420n;

        const {
            initAuction,
            executeOrder,
            prepareOrderResponse,
            executeLate: inputExecuteLate,
        } = args;

        const executeLate = inputExecuteLate ?? false;

        const redeemer = Keypair.generate();
        const sourceCctpDomain = 0;
        const cctpNonce = testCctpNonce++;
        const amountIn = 690000n; // 69 cents

        // Concoct a Circle message.
        const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
        const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
            await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amountIn);

        const maxFee = 42069n;
        const currTime = await connection.getBlockTime(await connection.getSlot());
        const fastMessage = new LiquidityLayerMessage({
            fastMarketOrder: {
                amountIn,
                minAmountOut: 0n,
                targetChain: arbChain,
                redeemer: Array.from(redeemer.publicKey.toBuffer()),
                sender: new Array(32).fill(0),
                refundAddress: new Array(32).fill(0),
                maxFee,
                initAuctionFee: 2000n,
                deadline: currTime! + 2,
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
                    mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                },
                {
                    slowOrderResponse: {
                        baseFee,
                    },
                },
            ),
        });

        const finalizedVaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            ethRouter,
            wormholeSequence++,
            finalizedMessage,
        );
        const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);

        const fastVaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            ethRouter,
            wormholeSequence++,
            fastMessage,
        );
        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);

        const prepareIx = await engine.prepareOrderResponseCctpIx(
            {
                payer: payer.publicKey,
                fastVaa,
                finalizedVaa,
            },
            {
                encodedCctpMessage,
                cctpAttestation,
            },
        );

        const fastVaaHash = fastVaaAccount.digest();
        const preparedBy = payer.publicKey;
        const preparedOrderResponse = engine.preparedOrderResponseAddress(fastVaaHash);
        const auction = engine.auctionAddress(fastVaaHash);

        if (initAuction) {
            const [approveIx, ix] = await engine.placeInitialOfferIx(
                {
                    payer: playerOne.publicKey,
                    fastVaa,
                },
                maxFee,
            );
            await expectIxOk(connection, [approveIx, ix], [playerOne]);

            if (executeOrder) {
                const { info } = await engine.fetchAuction({ address: auction });
                if (info === null) {
                    throw new Error("No auction info found");
                }
                const { configId, bestOfferToken, initialOfferToken, startSlot } = info;
                const auctionConfig = engine.auctionConfigAddress(configId);
                const { duration, gracePeriod, penaltyPeriod } =
                    await engine.fetchAuctionParameters(configId);

                const endSlot = (() => {
                    if (executeLate) {
                        return startSlot
                            .addn(duration + gracePeriod + penaltyPeriod - 1)
                            .toNumber();
                    } else {
                        return startSlot.addn(duration + gracePeriod - 1).toNumber();
                    }
                })();

                await waitUntilSlot(connection, endSlot);

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 300_000,
                });
                const ix = await engine.executeFastOrderCctpIx({
                    payer: payer.publicKey,
                    fastVaa,
                    auction,
                    auctionConfig,
                    bestOfferToken,
                    initialOfferToken,
                });
                await expectIxOk(connection, [computeIx, ix], [payer]);
            }
        }

        if (prepareOrderResponse) {
            const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: 300_000,
            });
            const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                lookupTableAddress,
            );
            await expectIxOk(connection, [computeIx, prepareIx], [payer], {
                addressLookupTableAccounts: [lookupTableAccount!],
            });
        }

        return {
            baseFee,
            fastMessage,
            fastVaa,
            fastVaaAccount,
            finalizedVaa,
            finalizedVaaAccount,
            prepareIx: prepareOrderResponse ? null : prepareIx,
            preparedOrderResponse,
            auction,
            preparedBy,
        };
    }

    function newFastMarketOrder(
        args: {
            amountIn?: bigint;
            minAmountOut?: bigint;
            initAuctionFee?: bigint;
            targetChain?: wormholeSdk.ChainName;
            maxFee?: bigint;
            deadline?: number;
            redeemerMessage?: Buffer;
        } = {},
    ): FastMarketOrder {
        const {
            amountIn,
            targetChain,
            minAmountOut,
            maxFee,
            initAuctionFee,
            deadline,
            redeemerMessage,
        } = args;

        return {
            amountIn: amountIn ?? 1_000_000_000n,
            minAmountOut: minAmountOut ?? 0n,
            targetChain: wormholeSdk.coalesceChainId(targetChain ?? "arbitrum"),
            redeemer: new Array(32).fill(1),
            sender: new Array(32).fill(2),
            refundAddress: new Array(32).fill(3),
            maxFee: maxFee ?? 42069n,
            initAuctionFee: initAuctionFee ?? 1_250_000n,
            deadline: deadline ?? 0,
            redeemerMessage: redeemerMessage ?? Buffer.from("Somebody set up us the bomb"),
        };
    }

    function newSlowOrderResponse(args: { baseFee?: bigint } = {}): SlowOrderResponse {
        const { baseFee } = args;

        return {
            baseFee: baseFee ?? 420n,
        };
    }

    async function observeCctpOrderVaas(
        args: {
            sourceChain?: wormholeSdk.ChainName;
            fastMarketOrder?: FastMarketOrder;
            slowOrderResponse?: SlowOrderResponse;
            finalized?: boolean;
        } = {},
    ): Promise<{
        fast: {
            vaa: PublicKey;
            vaaAccount: VaaAccount;
        };
        finalized?: {
            vaa: PublicKey;
            vaaAccount: VaaAccount;
            encodedCctpMessage: Buffer;
            cctpAttestation: Buffer;
        };
    }> {
        let { sourceChain, fastMarketOrder, slowOrderResponse, finalized } = args;
        sourceChain ??= "ethereum";
        fastMarketOrder ??= newFastMarketOrder();
        slowOrderResponse ??= newSlowOrderResponse();
        finalized ??= false;

        const sourceCctpDomain = CHAIN_TO_DOMAIN[sourceChain];
        if (sourceCctpDomain === undefined) {
            throw new Error(`Invalid source chain: ${sourceChain}`);
        }

        // TODO: consider taking this out this condition when other test methods use this method to
        // generate VAAs.
        const finalizedSequence = finalized ? wormholeSequence++ : 0n;
        const fastSequence = wormholeSequence++;

        const fastVaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            ethRouter,
            fastSequence,
            new LiquidityLayerMessage({
                fastMarketOrder,
            }),
        );
        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);
        const fast = { vaa: fastVaa, vaaAccount: fastVaaAccount };

        if (finalized) {
            const { amountIn: amount } = fastMarketOrder;
            const cctpNonce = testCctpNonce++;

            // Concoct a Circle message.
            const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amount);

            const finalizedMessage = new LiquidityLayerMessage({
                deposit: new LiquidityLayerDeposit(
                    {
                        tokenAddress: burnMessage.burnTokenAddress,
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: Array.from(Buffer.alloc(32, "beefdead", "hex")),
                        mintRecipient: Array.from(engine.cctpMintRecipientAddress().toBuffer()),
                    },
                    {
                        slowOrderResponse,
                    },
                ),
            });

            const finalizedVaa = await postLiquidityLayerVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                ethRouter,
                finalizedSequence,
                finalizedMessage,
            );
            const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
            return {
                fast,
                finalized: {
                    vaa: finalizedVaa,
                    vaaAccount: finalizedVaaAccount,
                    encodedCctpMessage,
                    cctpAttestation,
                },
            };
        } else {
            return { fast };
        }
    }

    async function craftCctpTokenBurnMessage(
        sourceCctpDomain: number,
        cctpNonce: bigint,
        amount: bigint,
        overrides: { destinationCctpDomain?: number } = {},
    ) {
        const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

        const messageTransmitterProgram = engine.messageTransmitterProgram();
        const { version, localDomain } =
            await messageTransmitterProgram.fetchMessageTransmitterConfig(
                messageTransmitterProgram.messageTransmitterConfigAddress(),
            );
        const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

        const tokenMessengerMinterProgram = engine.tokenMessengerMinterProgram();
        const { tokenMessenger: sourceTokenMessenger } =
            await tokenMessengerMinterProgram.fetchRemoteTokenMessenger(
                tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceCctpDomain),
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
            Array.from(engine.cctpMintRecipientAddress().toBuffer()), // mint recipient
            amount,
            new Array(32).fill(0), // burnSource
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
});
