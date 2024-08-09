import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Signer,
    SystemProgram,
    TransactionInstruction,
    VersionedTransactionResponse,
} from "@solana/web3.js";
import {
    FastMarketOrder,
    Fill,
    SlowOrderResponse,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, ChainId, encoding, toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { deserializePostMessage } from "@wormhole-foundation/sdk-solana-core";
import { expect } from "chai";
import { CctpTokenBurnMessage } from "../src/cctp";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    uint64ToBN,
    uint64ToBigInt,
} from "../src/common";
import {
    Auction,
    AuctionConfig,
    AuctionHistory,
    AuctionParameters,
    CctpMessageArgs,
    Custodian,
    MatchingEngineProgram,
    PreparedOrderResponse,
    Proposal,
    RouterEndpoint,
    localnet,
} from "../src/matchingEngine";
import {
    CHAIN_TO_DOMAIN,
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    PLAYER_ONE_KEYPAIR,
    REGISTERED_TOKEN_ROUTERS,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    expectIxOkDetails,
    getBlockTime,
    getUsdcAtaBalance,
    postLiquidityLayerVaa,
    toUniversalAddress,
    waitUntilSlot,
    waitUntilTimestamp,
} from "../src/testing";
import { VaaAccount } from "../src/wormhole";

const SLOTS_PER_EPOCH = 8;

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "processed");

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
    const playerOne = PLAYER_ONE_KEYPAIR;
    const playerTwo = Keypair.generate();
    const liquidator = Keypair.generate();

    // Foreign endpoints.
    const ethChain = toChainId("Ethereum");
    const ethRouter = REGISTERED_TOKEN_ROUTERS["Ethereum"]!;
    const ethDomain = CHAIN_TO_DOMAIN["Ethereum"]!;

    const arbChain = toChainId("Arbitrum");
    const arbRouter = REGISTERED_TOKEN_ROUTERS["Arbitrum"]!;
    const arbDomain = CHAIN_TO_DOMAIN["Arbitrum"]!;

    const solanaChain = toChainId("Solana");

    // Matching Engine program.
    const engine = new MatchingEngineProgram(connection, localnet(), USDC_MINT_ADDRESS);

    let lookupTableAddress: PublicKey;

    const auctionParams: AuctionParameters = {
        userPenaltyRewardBps: 250_000, // 25%
        initialPenaltyBps: 250_000, // 25%
        duration: 2,
        gracePeriod: 5,
        penaltyPeriod: 10,
        minOfferDeltaBps: 20_000, // 2%
        securityDepositBase: uint64ToBN(4_200_000n),
        securityDepositBps: 5_000, // 0.5%
    };

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 10n * 6400n;

    let wormholeSequence = 1000n;

    describe("Admin", function () {
        describe("Initialize", function () {
            const localVariables = new Map<string, any>();

            before("Transfer Lamports to Executors", async function () {
                await expectIxOk(
                    connection,
                    [
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: owner.publicKey,
                            lamports: 10000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: ownerAssistant.publicKey,
                            lamports: 10000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: playerOne.publicKey,
                            lamports: 10000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: playerTwo.publicKey,
                            lamports: 10000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: payer.publicKey,
                            toPubkey: liquidator.publicKey,
                            lamports: 10000000000,
                        }),
                    ],
                    [payer],
                );
            });

            before("Set up ATAs for Various Owners", async function () {
                for (const tokenOwner of [
                    PublicKey.default,
                    feeRecipient,
                    playerOne.publicKey,
                    playerTwo.publicKey,
                    liquidator.publicKey,
                ]) {
                    const destination = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        tokenOwner,
                    );
                    const createIx = splToken.createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        destination,
                        tokenOwner,
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

            it("Cannot Initialize with Zero Auction Duration", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, duration: 0 },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: ZeroDuration");
            });

            it("Cannot Initialize with Zero Auction Grace Period", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, gracePeriod: 0 },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: ZeroGracePeriod");
            });

            it("Cannot Initialize with Zero Auction Penalty Period", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, penaltyPeriod: 0 },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: ZeroPenaltyPeriod");
            });

            it("Cannot Initialize with Invalid User Penalty Bps", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, userPenaltyRewardBps: 1_000_001 },
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: UserPenaltyRewardBpsTooLarge",
                );
            });

            it("Cannot Initialize with Invalid Initial Penalty Bps", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, initialPenaltyBps: 1_000_001 },
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: InitialPenaltyBpsTooLarge",
                );
            });

            it("Cannot Initialize with Invalid Min Offer Delta Bps", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, minOfferDeltaBps: 1_000_001 },
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: MinOfferDeltaBpsTooLarge",
                );
            });

            it("Cannot Initialize with Invalid Security Deposit Base", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, securityDepositBase: uint64ToBN(0) },
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: ZeroSecurityDepositBase");
            });

            it("Cannot Initialize with Invalid Security Deposit Bps", async function () {
                const ix = await engine.initializeIx(
                    {
                        owner: payer.publicKey,
                        ownerAssistant: ownerAssistant.publicKey,
                        feeRecipient,
                        mint: USDC_MINT_ADDRESS,
                    },
                    { ...auctionParams, securityDepositBps: 1_000_001 },
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: SecurityDepositBpsTooLarge",
                );
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
                        false,
                        payer.publicKey,
                        ownerAssistant.publicKey,
                        feeRecipientToken,
                        expectedAuctionConfigId,
                        uint64ToBN(0),
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
                    "AssistantZeroPubkey",
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

        describe("Set Pause", async function () {
            it("Cannot Set Pause for Transfers as Non-Owner", async function () {
                const ix = await engine.setPauseIx(
                    {
                        ownerOrAssistant: payer.publicKey,
                    },
                    true, // paused
                );

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Set Paused == true as Owner Assistant", async function () {
                const paused = true;
                const ix = await engine.setPauseIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    paused,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const { paused: actualPaused, pausedSetBy } = await engine.fetchCustodian();
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(ownerAssistant.publicKey);
            });

            it("Set Paused == false as Owner", async function () {
                const paused = false;
                const ix = await engine.setPauseIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    paused,
                );

                await expectIxOk(connection, [ix], [owner]);

                const { paused: actualPaused, pausedSetBy } = await engine.fetchCustodian();
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(owner.publicKey);
            });
        });

        describe("Router Endpoint (CCTP)", function () {
            const localVariables = new Map<string, any>();

            after("Register To Router Endpoints", async function () {
                const ix = await engine.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    {
                        chain: toChainId("Arbitrum"),
                        cctpDomain: CHAIN_TO_DOMAIN["Arbitrum"]!,
                        address: REGISTERED_TOKEN_ROUTERS["Arbitrum"]!,
                        mintRecipient: null,
                    },
                );
                await expectIxOk(connection, [ix], [owner]);
            });

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

            [0, solanaChain].forEach((chain) =>
                it(`Cannot Register Chain ID == ${chain}`, async function () {
                    const ix = await engine.addCctpRouterEndpointIx(
                        { ownerOrAssistant: owner.publicKey },
                        {
                            chain: chain as ChainId,
                            cctpDomain: ethDomain,
                            address: ethRouter,
                            mintRecipient: null,
                        },
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
                    new RouterEndpoint(255, {
                        chain: ethChain,
                        address: contractAddress,
                        mintRecipient,
                        protocol: {
                            cctp: { domain: ethDomain },
                        },
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
                    new RouterEndpoint(bump, {
                        chain: ethChain,
                        address: new Array(32).fill(0),
                        mintRecipient: new Array(32).fill(0),
                        protocol: { none: {} },
                    }),
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
                    new RouterEndpoint(255, {
                        chain: ethChain,
                        address: ethRouter,
                        mintRecipient: ethRouter,
                        protocol: {
                            cctp: { domain: ethDomain },
                        },
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
                userPenaltyRewardBps: 1_000_000, // 100%
                initialPenaltyBps: 1_000_000, // 100%
                duration: 1,
                gracePeriod: 3,
                penaltyPeriod: 5,
                minOfferDeltaBps: 10_000, // 1%
                securityDepositBase: uint64ToBN(69),
                securityDepositBps: 100_000, // 10%
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

            it("Cannot Propose New Auction Parameters (Zero Duration)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, duration: 0 },
                );

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: ZeroDuration");
            });

            it("Cannot Propose New Auction Parameters (Zero Grace Period)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, gracePeriod: 0 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: ZeroGracePeriod",
                );
            });

            it("Cannot Propose New Auction Parameters (Zero Penalty Period)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, penaltyPeriod: 0 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: ZeroPenaltyPeriod",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid User Penalty Bps Too Large)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, userPenaltyRewardBps: 1_000_001 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: UserPenaltyRewardBpsTooLarge",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid Initial Penalty Bps Too Large)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, initialPenaltyBps: 1_000_001 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: InitialPenaltyBpsTooLarge",
                );
            });

            it("Cannot Propose New Auction Parameters (Invalid Min Offer Delta Bps Too Large)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, minOfferDeltaBps: 1_000_001 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: MinOfferDeltaBpsTooLarge",
                );
            });

            it("Cannot Propose New Auction Parameters (Zero Security Deposit Base)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, securityDepositBase: uint64ToBN(0) },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: ZeroSecurityDepositBase",
                );
            });

            it("Cannot Propose New Auction Parameters (Security Deposit Bps Too Large)", async function () {
                const ix = await engine.proposeAuctionParametersIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    { ...newAuctionParameters, securityDepositBps: 1_000_001 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: SecurityDepositBpsTooLarge",
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
                        uint64ToBN(currentSlot),
                        uint64ToBN(currentSlot + SLOTS_PER_EPOCH),
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

            it("Cannot Close Proposal as Non-Admin", async function () {
                const ix = await engine.closeProposalIx({
                    ownerOrAssistant: payer.publicKey,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Close Proposal as Owner", async function () {
                const ix = await engine.closeProposalIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                });

                await expectIxOk(connection, [ix], [ownerAssistant]);
            });

            it("Close Proposal as Owner Assistant", async function () {
                await expectIxOk(
                    connection,
                    [
                        await engine.proposeAuctionParametersIx(
                            {
                                ownerOrAssistant: ownerAssistant.publicKey,
                            },
                            newAuctionParameters,
                        ),
                    ],
                    [ownerAssistant],
                );

                const ix = await engine.closeProposalIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                });

                await expectIxOk(connection, [ix], [ownerAssistant]);
            });

            it("Cannot Close Proposal (Proposal Already Enacted)", async function () {
                const { nextProposalId } = await engine.fetchCustodian();

                await expectIxOk(
                    connection,
                    [
                        await engine.proposeAuctionParametersIx(
                            {
                                ownerOrAssistant: owner.publicKey,
                            },
                            newAuctionParameters,
                        ),
                    ],
                    [owner],
                );

                const proposal = await engine.proposalAddress(nextProposalId);
                const proposalDataBefore = await engine.fetchProposal({ address: proposal });

                await waitUntilSlot(
                    connection,
                    proposalDataBefore.slotEnactDelay.toNumber() + SLOTS_PER_EPOCH + 1,
                );

                await expectIxOk(
                    connection,
                    [
                        await engine.updateAuctionParametersIx({
                            owner: owner.publicKey,
                            proposal,
                        }),
                    ],
                    [owner],
                );

                // Try to close the proposal after it's been enacted.
                const ix = await engine.closeProposalIx({
                    ownerOrAssistant: owner.publicKey,
                    proposal: proposal,
                });
                await expectIxErr(connection, [ix], [owner], "Error Code: ProposalAlreadyEnacted");
            });
        });

        describe("Update Auction Parameters", async function () {
            const localVariables = new Map<string, any>();

            // Create a new set of auction parameters.
            const newAuctionParameters: AuctionParameters = {
                userPenaltyRewardBps: 300_000, // 30%
                initialPenaltyBps: 200_000, // 20%
                duration: 5,
                gracePeriod: 7,
                penaltyPeriod: 8,
                minOfferDeltaBps: 50_000, // 5%
                securityDepositBase: uint64ToBN(690_000), // 0.69 USDC
                securityDepositBps: 20_000, // 2%
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
                    uint64ToBN(await connection.getSlot()),
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
            targetChain: toChain(arbChain),
            redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
            sender: toUniversalAddress(Buffer.alloc(32, "beefdead", "hex")),
            refundAddress: toUniversalAddress(Buffer.alloc(32, "beef", "hex")),
            maxFee: 1000000n,
            initAuctionFee: 100n,
            deadline: 0,
            redeemerMessage: encoding.bytes.encode("All your base are belong to us."),
        };

        describe("Place Initial CCTP Offer", function () {
            for (const offerPrice of [0n, baseFastOrder.maxFee / 2n, baseFastOrder.maxFee]) {
                it(`Place Initial Offer (Price == ${offerPrice})`, async function () {
                    await placeInitialOfferCctpForTest(
                        {
                            payer: playerOne.publicKey,
                        },
                        {
                            args: {
                                offerPrice,
                            },
                            signers: [playerOne],
                            finalized: false,
                            fastMarketOrder: baseFastOrder,
                        },
                    );
                });
            }

            it("Place Initial Offer (Tx)", async function () {
                const { fast } = await observeCctpOrderVaas({ sourceChain: "Ethereum" });

                const auction = engine.auctionAddress(fast.vaaAccount.digest());
                const { auctionConfigId } = await engine.fetchCustodian();

                const { vaa: fastVaa, fastMarketOrder } = fast;
                const notionalDeposit = await engine.computeNotionalSecurityDeposit(
                    fastMarketOrder.amountIn,
                    auctionConfigId,
                );

                const totalDeposit =
                    fastMarketOrder.amountIn + fastMarketOrder.maxFee + notionalDeposit;
                const txn = await engine.placeInitialOfferTx(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                        toRouterEndpoint: engine.routerEndpointAddress(
                            toChainId(fastMarketOrder.targetChain),
                        ),
                        auction,
                    },
                    { offerPrice: fast.fastMarketOrder.maxFee, totalDeposit },
                    [playerOne],
                    { feeMicroLamports: 10, computeUnits: 200000 },
                    { commitment: "confirmed" },
                );

                await expectIxOk(connection, txn.ixs, [playerOne]);
            });

            it("Place Initial Offer (Offer == Max Fee; Max Fee == Amount Minus 1)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: {
                            ...baseFastOrder,
                            maxFee: baseFastOrder.amountIn - 1n,
                        },
                    },
                );
            });

            it("Place Initial Offer with Deadline", async function () {
                const currTime = await getBlockTime(connection);

                // Set the deadline to 10 seconds from now.
                const deadline = currTime + 10;

                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        fastMarketOrder: { ...baseFastOrder, deadline },
                        finalized: false,
                    },
                );
            });

            it("Cannot Place Initial Offer (Fast VAA Expired)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        vaaTimestamp: 69,
                        errorMsg: "Error Code: FastMarketOrderExpired",
                    },
                );
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
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        auction,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                    },
                    {
                        args: {
                            offerPrice: 69n,
                            totalDeposit: 69n,
                        },
                        signers: [playerOne],
                        errorMsg: "Error Code: InvalidVaa",
                    },
                );
            });

            it("Cannot Place Initial Offer (Paused)", async function () {
                // Pause the matching engine. TODO: make pauseForTest.
                await expectIxOk(
                    connection,
                    [
                        await engine.setPauseIx(
                            {
                                ownerOrAssistant: owner.publicKey,
                            },
                            true,
                        ),
                    ],
                    [owner],
                );

                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        errorMsg: "Error Code: Paused",
                    },
                );

                // Unpause the matching engine.
                await expectIxOk(
                    connection,
                    [
                        await engine.setPauseIx(
                            {
                                ownerOrAssistant: owner.publicKey,
                            },
                            false,
                        ),
                    ],
                    [owner],
                );
            });

            it("Cannot Place Initial Offer (Endpoint Disabled)", async function () {
                // Disable the Eth router endpoint. TODO: make disableEndpointForTest.
                await expectIxOk(
                    connection,
                    [await engine.disableRouterEndpointIx({ owner: owner.publicKey }, ethChain)],
                    [owner],
                );

                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        errorMsg: "Error Code: EndpointDisabled",
                    },
                );

                // Enabled the Eth Router again.
                await expectIxOk(
                    connection,
                    [
                        await engine.updateCctpRouterEndpointIx(
                            { owner: owner.publicKey },
                            {
                                chain: ethChain,
                                cctpDomain: ethDomain,
                                address: ethRouter,
                                mintRecipient: null,
                            },
                        ),
                    ],
                    [owner],
                );
            });

            it("Cannot Place Initial Offer (Invalid Payload)", async function () {
                const fastVaa = await postLiquidityLayerVaa(
                    connection,
                    playerOne,
                    MOCK_GUARDIANS,
                    ethRouter,
                    wormholeSequence++,
                    new LiquidityLayerMessage({
                        deposit: new LiquidityLayerDeposit({
                            tokenAddress: toUniversalAddress(Array(32).fill(69)),
                            amount: 1000n,
                            sourceCctpDomain: 69,
                            destinationCctpDomain: 69,
                            cctpNonce: 6969n,
                            burnSource: toUniversalAddress(new Array(32).fill(69)),
                            mintRecipient: toUniversalAddress(Array(32).fill(69)),
                            payload: {
                                id: 1,
                                sourceChain: toChain(ethChain),
                                orderSender: baseFastOrder.sender,
                                redeemer: baseFastOrder.redeemer,
                                redeemerMessage: baseFastOrder.redeemerMessage,
                            },
                        }),
                    }),
                );

                const auction = await VaaAccount.fetch(connection, fastVaa).then((vaa) =>
                    engine.auctionAddress(vaa.digest()),
                );
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                        auction,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                    },
                    {
                        args: {
                            offerPrice: 69n,
                            totalDeposit: 69n,
                        },
                        signers: [playerOne],
                        errorMsg: "Error Code: NotFastMarketOrder",
                    },
                );
            });

            it("Cannot Place Initial Offer (Deadline Exceeded)", async function () {
                // Set the deadline to the previous block timestamp.
                const deadline = await connection
                    .getSlot()
                    .then((slot) => connection.getBlockTime(slot))
                    .then((blockTime) => blockTime! - 1);

                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: { ...baseFastOrder, deadline },
                        errorMsg: "Error Code: FastMarketOrderExpired",
                    },
                );
            });

            it("Cannot Place Initial Offer (Offer Price Too High)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        args: {
                            offerPrice: baseFastOrder.maxFee + 1n,
                        },
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        errorMsg: "Error Code: OfferPriceTooHigh",
                    },
                );
            });

            it("Cannot Place Initial Offer (Invalid Emitter Chain)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        fromRouterEndpoint: engine.routerEndpointAddress(ethChain),
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        sourceChain: "Polygon",
                        emitter: REGISTERED_TOKEN_ROUTERS["Ethereum"],
                        errorMsg: "Error Code: InvalidSourceRouter",
                    },
                );
            });

            it("Cannot Place Initial Offer (Invalid Emitter Address)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        args: {
                            offerPrice: baseFastOrder.maxFee + 1n,
                        },
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        sourceChain: "Ethereum",
                        emitter: REGISTERED_TOKEN_ROUTERS["Arbitrum"],
                        errorMsg: "Error Code: InvalidSourceRouter",
                    },
                );
            });

            it("Cannot Place Initial Offer (Invalid Target Router Chain)", async function () {
                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        toRouterEndpoint: engine.routerEndpointAddress(arbChain),
                    },
                    {
                        args: {
                            offerPrice: baseFastOrder.maxFee + 1n,
                        },
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: {
                            ...baseFastOrder,
                            targetChain: "Acala",
                        },
                        errorMsg: "Error Code: InvalidTargetRouter",
                    },
                );
            });

            it("Cannot Place Initial Offer Again", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );

                await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        fastVaa: result!.fastVaa,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                        errorMsg: `Allocate: account Address { address: ${result!.auction.toString()}, base: None } already in use`,
                    },
                );
            });
        });

        describe("Improve Offer", function () {
            for (const newOffer of [0n, baseFastOrder.maxFee / 2n]) {
                it(`Improve Offer (Price == ${newOffer})`, async function () {
                    const result = await placeInitialOfferCctpForTest(
                        {
                            payer: playerOne.publicKey,
                        },
                        {
                            signers: [playerOne],
                            finalized: false,
                            fastMarketOrder: baseFastOrder,
                        },
                    );
                    const { auction, auctionDataBefore } = result!;

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
                        { offerPrice: newOffer },
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

            it("Improve Offer (Tx)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

                const currentOffer = BigInt(auctionDataBefore.info!.offerPrice.toString());
                const newOffer =
                    BigInt(auctionDataBefore.info!.offerPrice.toString()) -
                    (await engine.computeMinOfferDelta(currentOffer)) -
                    100n;

                const txn = await engine.improveOfferTx(
                    {
                        participant: playerTwo.publicKey,
                        auction,
                        auctionConfig: engine.auctionConfigAddress(
                            auctionDataBefore.info!.configId,
                        ),
                        bestOfferToken: auctionDataBefore.info!.bestOfferToken,
                    },
                    {
                        offerPrice: newOffer,
                        totalDeposit: auctionDataBefore.info!.amountIn.add(
                            auctionDataBefore.info!.securityDeposit,
                        ),
                    },
                    [playerTwo],
                    { feeMicroLamports: 10, computeUnits: 200000 },
                    { commitment: "confirmed" },
                );

                await expectIxOk(connection, txn.ixs, [playerTwo]);
            });

            it("Improve Offer By Min Offer Delta", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

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
                    { offerPrice: newOffer },
                );

                await expectIxOk(connection, [approveIx, ix], [playerTwo]);

                await checkAfterEffects(auction, playerTwo.publicKey, newOffer, auctionDataBefore, {
                    custodyToken: custodyBalanceBefore,
                    bestOfferToken: newOfferBalanceBefore,
                    prevBestOfferToken: initialOfferBalanceBefore,
                });
            });

            it("Improve Offer With Same Best Offer Token Account", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

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
                    { offerPrice: newOffer },
                );

                await expectIxOk(connection, [approveIx, ix], [playerOne]);

                await checkAfterEffects(auction, playerOne.publicKey, newOffer, auctionDataBefore, {
                    custodyToken: custodyBalanceBefore,
                    bestOfferToken: initialOfferBalanceBefore,
                });
            });

            it("Cannot Improve Offer (Auction Expired)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

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
                    { offerPrice: newOffer },
                );

                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "Error Code: AuctionPeriodExpired",
                );
            });

            it("Cannot Improve Offer (Invalid Best Offer Token Account)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

                // New Offer from playerOne.
                const newOffer = BigInt(auctionDataBefore.info!.offerPrice.subn(100).toString());

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerOne.publicKey,
                        bestOfferToken: engine.cctpMintRecipientAddress(),
                    },
                    { offerPrice: newOffer },
                );
                await expectIxErr(
                    connection,
                    [approveIx, ix],
                    [playerOne],
                    "best_offer_token. Error Code: ConstraintAddress",
                );
            });

            it("Cannot Improve Offer (Carping Not Allowed)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        signers: [playerOne],
                        finalized: false,
                        fastMarketOrder: baseFastOrder,
                    },
                );
                const { auction, auctionDataBefore } = result!;

                // Attempt to improve by the minimum allowed.
                const newOffer = BigInt(auctionDataBefore.info!.offerPrice.toString()) - 1n;
                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        auction,
                        participant: playerTwo.publicKey,
                    },
                    { offerPrice: newOffer },
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

                const { bump, vaaHash, vaaTimestamp, targetProtocol, status, preparedBy, info } =
                    auctionDataBefore;
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
                    destinationAssetInfo,
                    sourceChain,
                    redeemerMessageLen,
                } = info!;
                expect(offerPrice).not.equals(BigInt(prevOfferPrice.toString()));

                const auctionDataAfter = await engine.fetchAuction({ address: auction });
                expect(auctionDataAfter).to.eql(
                    new Auction(bump, vaaHash, vaaTimestamp, targetProtocol, status, preparedBy, {
                        configId,
                        custodyTokenBump,
                        vaaSequence,
                        sourceChain,
                        bestOfferToken,
                        initialOfferToken,
                        startSlot,
                        amountIn,
                        securityDeposit,
                        offerPrice: uint64ToBN(offerPrice),
                        redeemerMessageLen,
                        destinationAssetInfo,
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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

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
                    "Ethereum",
                    "Arbitrum",
                );

                localVariables.set("auction", auction);
            });

            it("Execute Fast Order (Tx)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    initialData.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );

                const tx = await engine.executeFastOrderTx(
                    { payer: playerTwo.publicKey, fastVaa, auction },
                    [playerTwo],
                    {
                        feeMicroLamports: 10,
                        computeUnits: 400_000,
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                    { commitment: "confirmed" },
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 400_000,
                });

                await expectIxOkDetails(connection, [computeIx, ...tx.ixs], [playerTwo], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });
            });

            it("Reclaim by Closing CCTP Message", async function () {
                const auction = localVariables.get("auction") as PublicKey;

                const cctpMessage = engine.cctpMessageAddress(auction);
                const expectedLamports = await connection
                    .getAccountInfo(cctpMessage)
                    .then((info) => info!.lamports);

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

                await expectIxOk(connection, [ix], [payer, playerOne]);

                const balanceAfter = await connection.getBalance(playerOne.publicKey);
                expect(balanceAfter - balanceBefore).equals(expectedLamports);
            });

            it("Cannot Improve Offer After Execute Order", async function () {
                const auction = localVariables.get("auction") as PublicKey;
                expect(localVariables.delete("auction")).is.true;

                const [approveIx, ix] = await engine.improveOfferIx(
                    {
                        participant: playerOne.publicKey,
                        auction,
                    },
                    { offerPrice: baseFastOrder.maxFee },
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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Execute Fast Order After Grace Period with Liquidator", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Execute Fast Order After Grace Period with Liquidator (Initial Offer Token is Closed)", async function () {
                const tmpOwner = Keypair.generate();
                const transferLamportsToTmpOwnerIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: tmpOwner.publicKey,
                    lamports: 1_000_000_000n,
                });

                const tmpAta = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                );
                const createTmpAtaIx = splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    tmpAta,
                    tmpOwner.publicKey,
                    USDC_MINT_ADDRESS,
                );

                const mintAmount = 10_000_000n * 1_000_000n;
                const mintIx = splToken.createMintToInstruction(
                    USDC_MINT_ADDRESS,
                    tmpAta,
                    payer.publicKey,
                    mintAmount,
                );
                await expectIxOk(
                    connection,
                    [transferLamportsToTmpOwnerIx, createTmpAtaIx, mintIx],
                    [payer],
                );

                // Place the initial offer with a token account that will be closed.
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: tmpOwner.publicKey,
                    },
                    { signers: [tmpOwner], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

                // Burn funds out and close tmp ATA.
                const { amount: burnAmount } = await splToken.getAccount(connection, tmpAta);
                const burnIx = splToken.createBurnInstruction(
                    tmpAta,
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                    burnAmount,
                );
                const closeTokenAccountIx = splToken.createCloseAccountInstruction(
                    tmpAta,
                    payer.publicKey,
                    tmpOwner.publicKey,
                );
                await expectIxOk(connection, [burnIx, closeTokenAccountIx], [tmpOwner]);

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
                const initialOfferTokenBefore = await splToken
                    .getAccount(connection, initialOfferToken)
                    .then((token) => token.amount)
                    .catch((_) => 0n);
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
                    initialParticipant: payer.publicKey,
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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Execute Fast Order After Grace Period with Liquidator (Best Offer Token is Closed)", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

                const tmpOwner = Keypair.generate();
                const transferLamportsToTmpOwnerIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: tmpOwner.publicKey,
                    lamports: 1_000_000_000n,
                });

                const tmpAta = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                );
                const createTmpAtaIx = splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    tmpAta,
                    tmpOwner.publicKey,
                    USDC_MINT_ADDRESS,
                );

                const mintAmount = 10_000_000n * 1_000_000n;
                const mintIx = splToken.createMintToInstruction(
                    USDC_MINT_ADDRESS,
                    tmpAta,
                    payer.publicKey,
                    mintAmount,
                );
                await expectIxOk(
                    connection,
                    [transferLamportsToTmpOwnerIx, createTmpAtaIx, mintIx],
                    [payer],
                );

                // Improve the offer with a token account that will be closed. He will be the best
                // offer.
                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    tmpOwner,
                    improveBy,
                );

                // Burn funds out and close tmp ATA.
                const { amount: burnAmount } = await splToken.getAccount(connection, tmpAta);
                const burnIx = splToken.createBurnInstruction(
                    tmpAta,
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                    burnAmount,
                );
                const closeTokenAccountIx = splToken.createCloseAccountInstruction(
                    tmpAta,
                    payer.publicKey,
                    tmpOwner.publicKey,
                );
                await expectIxOk(connection, [burnIx, closeTokenAccountIx], [tmpOwner]);

                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const bestOfferTokenBefore = await splToken
                    .getAccount(connection, bestOfferToken)
                    .then((token) => token.amount)
                    .catch((_) => 0n);
                const initialOfferTokenBefore = await splToken
                    .getAccount(connection, initialOfferToken)
                    .then((token) => token.amount);
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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Execute Fast Order After Grace Period with Liquidator (Custody Token Has Extra)", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

                const tmpOwner = Keypair.generate();
                const transferLamportsToTmpOwnerIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: tmpOwner.publicKey,
                    lamports: 1_000_000_000n,
                });

                const tmpAta = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                );
                const createTmpAtaIx = splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    tmpAta,
                    tmpOwner.publicKey,
                    USDC_MINT_ADDRESS,
                );

                const mintAmount = 10_000_000n * 1_000_000n;
                const mintIx = splToken.createMintToInstruction(
                    USDC_MINT_ADDRESS,
                    tmpAta,
                    payer.publicKey,
                    mintAmount,
                );
                await expectIxOk(
                    connection,
                    [transferLamportsToTmpOwnerIx, createTmpAtaIx, mintIx],
                    [payer],
                );

                const improveBy = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(initialData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore: afterFirstImprovedData } = await improveOfferForTest(
                    auction,
                    tmpOwner,
                    improveBy,
                );

                // Burn funds out and close tmp ATA.
                const { amount: burnAmount } = await splToken.getAccount(connection, tmpAta);
                const burnIx = splToken.createBurnInstruction(
                    tmpAta,
                    USDC_MINT_ADDRESS,
                    tmpOwner.publicKey,
                    burnAmount,
                );
                const closeTokenAccountIx = splToken.createCloseAccountInstruction(
                    tmpAta,
                    payer.publicKey,
                    tmpOwner.publicKey,
                );
                await expectIxOk(connection, [burnIx, closeTokenAccountIx], [tmpOwner]);

                const improveByAgain = Number(
                    await engine.computeMinOfferDelta(
                        BigInt(afterFirstImprovedData.info!.offerPrice.toString()),
                    ),
                );
                const { auctionDataBefore } = await improveOfferForTest(
                    auction,
                    playerOne,
                    improveByAgain,
                );
                const { bestOfferToken, initialOfferToken } = auctionDataBefore.info!;

                // Fetch the balances before.
                const bestOfferTokenBefore = await splToken
                    .getAccount(connection, bestOfferToken)
                    .then((token) => token.amount)
                    .catch((_) => 0n);
                const initialOfferTokenBefore = await splToken
                    .getAccount(connection, initialOfferToken)
                    .then((token) => token.amount);
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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Execute Fast Order After Penalty Period with Liquidator", async function () {
                // Start the auction with offer two so that we can
                // check that the initial offer is refunded.
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auction, auctionDataBefore: initialData } = result!;

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
                    "Ethereum",
                    "Arbitrum",
                );
            });

            it("Cannot Execute Fast Order (Endpoint Disabled)", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    { signers: [playerOne], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auctionDataBefore } = result!;

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 2).toNumber(),
                );

                // Need to create the instruction before disabling the router.
                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                // Disable the arb endpoint before executing the order.
                await expectIxOk(
                    connection,
                    [await engine.disableRouterEndpointIx({ owner: owner.publicKey }, arbChain)],
                    [owner],
                );

                await expectIxErr(connection, [ix], [playerOne], "EndpointDisabled");

                // Enabled the Arb Router again.
                await expectIxOk(
                    connection,
                    [
                        await engine.updateCctpRouterEndpointIx(
                            { owner: owner.publicKey },
                            {
                                chain: arbChain,
                                cctpDomain: arbDomain,
                                address: arbRouter,
                                mintRecipient: null,
                            },
                        ),
                    ],
                    [owner],
                );
            });

            it("Cannot Execute Fast Order with VAA Hash Mismatch", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaaAccount, auction, auctionDataBefore } = result!;

                const anotherResult = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], fastMarketOrder: baseFastOrder },
                );
                const { fastVaa: anotherFastVaa, fastVaaAccount: anotherFastVaaAccount } =
                    anotherResult!;
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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    { signers: [playerOne], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auctionDataBefore } = result!;

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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    { signers: [playerOne], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auctionDataBefore } = result!;

                const bogusToken = engine.cctpMintRecipientAddress();

                const { initialOfferToken } = auctionDataBefore.info!;
                expect(bogusToken).to.not.eql(initialOfferToken);

                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                    initialOfferToken: bogusToken,
                });

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerTwo.publicKey,
                    },
                    { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa, auctionDataBefore } = result!;

                const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                await waitUntilSlot(
                    connection,
                    auctionDataBefore.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 250_000,
                });
                const ix = await engine.executeFastOrderCctpIx({
                    payer: playerOne.publicKey,
                    fastVaa,
                });

                await expectIxOk(connection, [computeIx, ix], [playerOne]);

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
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    { signers: [playerOne], finalized: false, fastMarketOrder: baseFastOrder },
                );
                const { fastVaa } = result!;

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
                fromChainName: Chain,
                toChainName: Chain,
            ) {
                const {
                    bestOfferToken: bestOfferTokenBefore,
                    initialOfferToken: initialOfferTokenBefore,
                    executorToken: executorTokenBefore,
                } = balancesBefore;
                let { custodyToken: custodyTokenBalance } = balancesBefore;

                const { bump, vaaHash, vaaTimestamp, preparedBy, info } = auctionDataBefore;

                const auctionDataAfter = await engine.fetchAuction({ address: auction });

                const { bestOfferToken, initialOfferToken, securityDeposit, amountIn, offerPrice } =
                    info!;

                // Validate balance changes.
                const bestOfferTokenExists = await connection
                    .getAccountInfo(bestOfferToken)
                    .then((info) => info !== null);
                const bestOfferTokenAfter = await splToken
                    .getAccount(connection, bestOfferToken)
                    .then((token) => token.amount)
                    .catch((_) => 0n);

                const initialOfferTokenExists = await connection
                    .getAccountInfo(initialOfferToken)
                    .then((info) => info !== null);
                const initialOfferTokenAfter = await splToken
                    .getAccount(connection, initialOfferToken)
                    .then((token) => token.amount)
                    .catch((_) => 0n);

                const { penalty, userReward } = await engine.computeDepositPenalty(
                    info!,
                    uint64ToBigInt(txDetails.slot),
                    info!.configId,
                );

                const {
                    targetChain,
                    initAuctionFee,
                    sender: orderSender,
                    redeemer,
                    redeemerMessage,
                } = baseFastOrder;

                // TODO: We need a better way to verify the executor token balance. We should have
                // an expected number of closed token accounts and multiply that by the total
                // deposit.
                //
                // Perhaps this will happen when we refactor the execute fast order tests.
                custodyTokenBalance -=
                    uint64ToBigInt(info!.amountIn.sub(info!.offerPrice)) - initAuctionFee;

                // The initAuctionFee is still a part of custodyTokenBalance. If we do pay the
                // initial offer token, we need to then remove it.
                if (initialOfferTokenExists && !bestOfferToken.equals(initialOfferToken)) {
                    custodyTokenBalance -= initAuctionFee;
                }

                const destinationDomain = CHAIN_TO_DOMAIN[toChain(targetChain)];
                expect(destinationDomain).is.not.undefined;

                if (hasPenalty) {
                    expect(penalty > 0n).is.true;
                    expect(userReward > 0n).is.true;

                    custodyTokenBalance -= userReward;

                    expect(auctionDataAfter).to.eql(
                        new Auction(
                            bump,
                            vaaHash,
                            vaaTimestamp,
                            { cctp: { domain: destinationDomain! } },
                            {
                                completed: {
                                    slot: uint64ToBN(txDetails.slot),
                                    executePenalty: uint64ToBN(penalty),
                                },
                            },
                            preparedBy,
                            info,
                        ),
                    );

                    let depositAndFee =
                        uint64ToBigInt(offerPrice.add(securityDeposit)) - userReward;
                    const executorToken = splToken.getAssociatedTokenAddressSync(
                        USDC_MINT_ADDRESS,
                        executor,
                    );
                    if (executorToken.equals(bestOfferToken)) {
                        expect(bestOfferTokenAfter).equals(
                            bestOfferTokenBefore + custodyTokenBalance,
                        );
                    } else {
                        depositAndFee -= penalty;

                        if (bestOfferTokenExists) {
                            custodyTokenBalance -= depositAndFee;
                        }

                        const { amount: executorTokenAfter } = await splToken.getAccount(
                            connection,
                            executorToken,
                        );

                        expect(executorTokenAfter).equals(
                            executorTokenBefore! + custodyTokenBalance,
                        );
                    }

                    if (bestOfferToken.equals(initialOfferToken)) {
                        expect(bestOfferTokenAfter).equals(
                            bestOfferTokenBefore +
                                depositAndFee +
                                initAuctionFee +
                                (bestOfferTokenExists
                                    ? 0n
                                    : uint64ToBigInt(info!.amountIn.add(info!.securityDeposit))),
                        );
                    } else {
                        if (bestOfferTokenExists) {
                            expect(bestOfferTokenAfter).equals(
                                bestOfferTokenBefore + depositAndFee,
                            );
                        }

                        if (initialOfferTokenExists) {
                            expect(initialOfferTokenAfter).equals(
                                initialOfferTokenBefore + initAuctionFee,
                            );
                        }
                    }
                } else {
                    expect(penalty).equals(0n);
                    expect(userReward).equals(0n);

                    expect(auctionDataAfter).to.eql(
                        new Auction(
                            bump,
                            vaaHash,
                            vaaTimestamp,
                            { cctp: { domain: destinationDomain! } },
                            {
                                completed: {
                                    slot: uint64ToBN(txDetails.slot),
                                    executePenalty: null,
                                },
                            },
                            preparedBy,
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
                const message = engine.coreMessageAddress(auction);

                const { payload } = await connection
                    .getAccountInfo(new PublicKey(message))
                    .then((info) => deserializePostMessage(info?.data!));

                const parsed = LiquidityLayerMessage.decode(Buffer.from(payload));
                expect(parsed.deposit?.message.payload).is.not.undefined;

                const {
                    protocol: { cctp },
                } = await engine.fetchRouterEndpointInfo(toChainId(targetChain));
                expect(cctp).is.not.undefined;

                const {
                    message: {
                        amount: actualAmount,
                        destinationCctpDomain,
                        mintRecipient,
                        payload: fill,
                    },
                } = parsed.deposit!;

                const userAmount =
                    BigInt(amountIn.sub(offerPrice).toString()) - initAuctionFee + userReward;
                expect(actualAmount).equals(userAmount);
                expect(destinationCctpDomain).equals(cctp!.domain);

                const sourceChain = fromChainName;
                const { mintRecipient: expectedMintRecipient } =
                    await engine.fetchRouterEndpointInfo(toChainId(toChainName));
                expect(Array.from(mintRecipient.toUint8Array())).to.eql(expectedMintRecipient);

                const expectedFill: Fill = {
                    // @ts-ignore
                    id: 1,
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

            it("Cannot Prepare Order Response with Emitter Chain Mismatch", async function () {
                const { fast, finalized } = await observeCctpOrderVaas({
                    sourceChain: "Ethereum",
                    finalizedSourceChain: "Arbitrum",
                });
                const fastEmitterInfo = fast.vaaAccount.emitterInfo();
                const finalizedEmitterInfo = finalized!.vaaAccount.emitterInfo();
                expect(fastEmitterInfo.chain).not.equals(finalizedEmitterInfo.chain);

                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                        fastVaa: fast.vaa,
                        finalizedVaa: finalized!.vaa,
                    },
                    {
                        args: finalized!.cctp,
                        placeInitialOffer: false,
                        errorMsg: "Error Code: VaaMismatch",
                    },
                );
            });

            it("Cannot Prepare Order Response with Emitter Address Mismatch", async function () {
                const { fast, finalized } = await observeCctpOrderVaas({
                    emitter: REGISTERED_TOKEN_ROUTERS["Ethereum"]!,
                    finalizedEmitter: REGISTERED_TOKEN_ROUTERS["Arbitrum"]!,
                });
                const fastEmitterInfo = fast.vaaAccount.emitterInfo();
                const finalizedEmitterInfo = finalized!.vaaAccount.emitterInfo();
                expect(fastEmitterInfo.chain).equals(finalizedEmitterInfo.chain);
                expect(fastEmitterInfo.address).not.eql(finalizedEmitterInfo.address);

                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                        fastVaa: fast.vaa,
                        finalizedVaa: finalized!.vaa,
                    },
                    {
                        args: finalized!.cctp,
                        placeInitialOffer: false,
                        errorMsg: "Error Code: VaaMismatch",
                    },
                );
            });

            it("Cannot Prepare Order Response with Emitter Sequence Mismatch", async function () {
                const { fast, finalized } = await observeCctpOrderVaas({
                    finalizedSequence: 69n,
                });
                const fastEmitterInfo = fast.vaaAccount.emitterInfo();
                const finalizedEmitterInfo = finalized!.vaaAccount.emitterInfo();
                expect(fastEmitterInfo.chain).equals(finalizedEmitterInfo.chain);
                expect(fastEmitterInfo.address).to.eql(finalizedEmitterInfo.address);
                expect(fastEmitterInfo.sequence).not.equals(finalizedEmitterInfo.sequence + 1n);

                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                        fastVaa: fast.vaa,
                        finalizedVaa: finalized!.vaa,
                    },
                    {
                        args: finalized!.cctp,
                        placeInitialOffer: false,
                        errorMsg: "Error Code: VaaMismatch",
                    },
                );
            });

            it("Cannot Prepare Order Response with VAA Timestamp Mismatch", async function () {
                const { fast, finalized } = await observeCctpOrderVaas({
                    finalizedVaaTimestamp: 420,
                });
                const fastEmitterInfo = fast.vaaAccount.emitterInfo();
                const finalizedEmitterInfo = finalized!.vaaAccount.emitterInfo();
                expect(fastEmitterInfo.chain).equals(finalizedEmitterInfo.chain);
                expect(fastEmitterInfo.address).to.eql(finalizedEmitterInfo.address);
                expect(fastEmitterInfo.sequence).equals(finalizedEmitterInfo.sequence + 1n);

                expect(fast.vaaAccount.timestamp()).not.equals(finalized!.vaaAccount.timestamp());

                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                        fastVaa: fast.vaa,
                        finalizedVaa: finalized!.vaa,
                    },
                    {
                        args: finalized!.cctp,
                        placeInitialOffer: false,
                        errorMsg: "Error Code: VaaMismatch",
                    },
                );
            });

            it("Prepare Order Response", async function () {
                const result = await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        placeInitialOffer: false,
                    },
                );
                const { fastVaa, finalizedVaa, args } = result!;

                // Save for later.
                localVariables.set("fastVaa", fastVaa);
                localVariables.set("finalizedVaa", finalizedVaa);
                localVariables.set("args", args);
            });

            it("Prepare Order Response for Same VAAs is No-op", async function () {
                const fastVaa = localVariables.get("fastVaa") as PublicKey;
                expect(localVariables.delete("fastVaa")).is.true;

                const finalizedVaa = localVariables.get("finalizedVaa") as PublicKey;
                expect(localVariables.delete("finalizedVaa")).is.true;

                const args = localVariables.get("args") as CctpMessageArgs;
                expect(localVariables.delete("args")).is.true;

                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                        fastVaa,
                        finalizedVaa,
                    },
                    {
                        args,
                        placeInitialOffer: false,
                        alreadyPrepared: true,
                    },
                );
            });

            it("Prepare Order Response for Active Auction", async function () {
                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        executeOrder: false,
                    },
                );
            });

            it("Prepare Order Response for Completed Auction Within Grace Period", async function () {
                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        executeWithinGracePeriod: true,
                    },
                );
            });

            it("Prepare Order Response for Completed Auction After Grace Period", async function () {
                await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        executeWithinGracePeriod: false,
                    },
                );
            });
        });

        describe("Settle Auction", function () {
            describe("Auction Complete", function () {
                it("Cannot Settle Non-Existent Auction", async function () {
                    const result = await prepareOrderResponseCctpForTest(
                        {
                            payer: payer.publicKey,
                        },
                        {
                            placeInitialOffer: false,
                        },
                    );
                    const fastVaaAccount = await VaaAccount.fetch(connection, result!.fastVaa);

                    await settleAuctionCompleteForTest(
                        {
                            executor: payer.publicKey,
                            preparedOrderResponse: result!.preparedOrderResponse,
                            auction: engine.auctionAddress(fastVaaAccount.digest()),
                            bestOfferToken: splToken.getAssociatedTokenAddressSync(
                                USDC_MINT_ADDRESS,
                                payer.publicKey,
                            ),
                        },
                        {
                            placeInitialOffer: false,
                            errorMsg: "auction. Error Code: AccountNotInitialized",
                        },
                    );
                });

                it("Cannot Settle Active Auction", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: payer.publicKey,
                        },
                        {
                            prepareSigners: [payer],
                            executeOrder: false,
                            errorMsg: "Error Code: AuctionNotCompleted",
                        },
                    );
                });

                it("Cannot Settle Completed Auction with No Penalty (Executor != Best Offer)", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: payer.publicKey,
                        },
                        {
                            prepareSigners: [payer],
                            executeWithinGracePeriod: true,
                            errorMsg: "Error Code: ExecutorTokenMismatch",
                        },
                    );
                });

                it("Settle Completed without Penalty", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: playerOne.publicKey,
                        },
                        {
                            prepareSigners: [playerOne],
                            executeWithinGracePeriod: true,
                        },
                    );
                });

                it("Settle Completed With Order Response Prepared Before Active Auction", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: playerOne.publicKey,
                        },
                        {
                            prepareSigners: [playerOne],
                            executeWithinGracePeriod: true,
                            prepareAfterExecuteOrder: false,
                        },
                    );
                });

                it("Cannot Settle Completed with Penalty (Executor != Prepared By)", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: playerOne.publicKey,
                        },
                        {
                            executeWithinGracePeriod: false,
                            executorIsPreparer: false,
                            errorMsg: "Error Code: ExecutorNotPreparedBy",
                        },
                    );
                });

                it("Settle Completed with Penalty (Executor == Best Offer)", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: playerOne.publicKey,
                        },
                        {
                            prepareSigners: [playerOne],
                            executeWithinGracePeriod: false,
                        },
                    );
                });

                it("Cannot Settle Completed with Penalty (Executor is not ATA)", async function () {
                    const executorTokenSigner = Keypair.generate();
                    const executorToken = executorTokenSigner.publicKey;

                    await expectIxOk(
                        connection,
                        [
                            SystemProgram.createAccount({
                                fromPubkey: payer.publicKey,
                                newAccountPubkey: executorToken,
                                lamports: await connection.getMinimumBalanceForRentExemption(
                                    splToken.ACCOUNT_SIZE,
                                ),
                                space: splToken.ACCOUNT_SIZE,
                                programId: splToken.TOKEN_PROGRAM_ID,
                            }),
                            splToken.createInitializeAccount3Instruction(
                                executorToken,
                                engine.mint,
                                playerTwo.publicKey,
                            ),
                        ],
                        [payer, executorTokenSigner],
                    );

                    await settleAuctionCompleteForTest(
                        {
                            executor: playerTwo.publicKey,
                            executorToken,
                        },
                        {
                            prepareSigners: [playerTwo],
                            executeWithinGracePeriod: false,
                            errorMsg: "Error Code: AccountNotAssociatedTokenAccount",
                        },
                    );
                });

                it("Settle Completed with Penalty (Executor != Best Offer)", async function () {
                    await settleAuctionCompleteForTest(
                        {
                            executor: playerTwo.publicKey,
                        },
                        {
                            prepareSigners: [playerTwo],
                            executeWithinGracePeriod: false,
                        },
                    );
                });

                it("Settle Completed (Tx)", async function () {
                    const { fast, finalized } = await observeCctpOrderVaas({
                        sourceChain: "Ethereum",
                    });

                    const result = await placeInitialOfferCctpForTest(
                        {
                            payer: playerTwo.publicKey,
                            fastVaa: fast.vaa,
                        },
                        { signers: [playerTwo], finalized: false, fastMarketOrder: baseFastOrder },
                    );
                    const { fastVaa, auction, auctionDataBefore: initialData } = result!;

                    const { duration, gracePeriod } = await engine.fetchAuctionParameters();
                    await waitUntilSlot(
                        connection,
                        initialData.info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                    );

                    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                        lookupTableAddress,
                    );

                    const tx = await engine.executeFastOrderTx(
                        { payer: playerTwo.publicKey, fastVaa, auction },
                        [playerTwo],
                        {
                            feeMicroLamports: 10,
                            computeUnits: 300_000,
                            addressLookupTableAccounts: [lookupTableAccount!],
                        },
                        { commitment: "confirmed" },
                    );

                    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                        units: 300_000,
                    });

                    await expectIxOkDetails(connection, [computeIx, ...tx.ixs], [playerTwo], {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    });

                    const tx2 = await engine.settleAuctionCompleteTx(
                        {
                            executor: playerTwo.publicKey,
                            auction,
                            fastVaa,
                            finalizedVaa: finalized!.vaa,
                            bestOfferToken: initialData.info!.bestOfferToken,
                        },
                        finalized!.cctp,
                        [playerTwo],
                        {
                            feeMicroLamports: 10,
                            computeUnits: 300_000,
                            addressLookupTableAccounts: [lookupTableAccount!],
                        },
                        { commitment: "confirmed" },
                    );
                    await expectIxOkDetails(connection, [computeIx, ...tx2.ixs], [playerTwo], {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    });
                });
            });

            describe("Settle No Auction (CCTP)", function () {
                it("Settle", async function () {
                    await settleAuctionNoneCctpForTest({
                        payer: payer.publicKey,
                    });
                });

                it("Settle (Tx)", async function () {
                    const { fast, finalized } = await observeCctpOrderVaas({
                        sourceChain: "Ethereum",
                    });

                    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                        lookupTableAddress,
                    );

                    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                        units: 500_000,
                    });

                    const tx = await engine.settleAuctionNoneTx(
                        {
                            executor: playerTwo.publicKey,
                            fastVaa: fast.vaa,
                            finalizedVaa: finalized!.vaa,
                        },
                        finalized!.cctp,
                        [playerTwo],
                        {
                            feeMicroLamports: 10,
                            computeUnits: 500_000,
                            addressLookupTableAccounts: [lookupTableAccount!],
                        },
                        { commitment: "confirmed" },
                    );
                    await expectIxOkDetails(connection, [computeIx, ...tx.ixs], [playerTwo], {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    });
                });
            });
        });

        describe("Auction History", function () {
            it("Cannot Create First Auction History with Incorrect PDA", async function () {
                await createFirstAuctionHistoryForTest(
                    {
                        payer: payer.publicKey,
                        firstHistory: Keypair.generate().publicKey,
                    },
                    {
                        errorMsg: "Error Code: ConstraintSeeds",
                    },
                );
            });

            it("Create First Auction History", async function () {
                await createFirstAuctionHistoryForTest({
                    payer: payer.publicKey,
                });
            });

            it("Cannot Create First Auction History Again", async function () {
                const auctionHistory = engine.auctionHistoryAddress(0);

                await createFirstAuctionHistoryForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        errorMsg: `Allocate: account Address { address: ${auctionHistory.toString()}, base: None } already in use`,
                    },
                );
            });

            it("Cannot Add Entry from Unsettled Auction", async function () {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    { signers: [playerOne], finalized: false },
                );

                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                        auction: result!.auction,
                        beneficiary: playerOne.publicKey,
                    },
                    {
                        errorMsg: "Error Code: AuctionNotSettled",
                    },
                );
            });

            it("Cannot Add Entry from Settled Complete Auction Before Expiration Time", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    {
                        settlementType: "complete",
                        waitToExpiration: false,
                        errorMsg: "Error Code: CannotCloseAuctionYet",
                    },
                );
            });

            it("Cannot Add Entry from Settled Complete Auction with Beneficiary Token != Initial Offer Token", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                        beneficiary: payer.publicKey,
                    },
                    {
                        settlementType: "complete",
                        errorMsg: "beneficiary_token. Error Code: ConstraintAddress",
                    },
                );
            });

            it("Cannot Add Entry from Settled Complete Auction with Beneficiary != Initial Offer Token Owner", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                        beneficiary: payer.publicKey,
                        beneficiaryToken: splToken.getAssociatedTokenAddressSync(
                            USDC_MINT_ADDRESS,
                            playerOne.publicKey,
                        ),
                    },
                    { settlementType: "complete", errorMsg: "Error Code: ConstraintTokenOwner" },
                );
            });

            it("Add Entry from Settled Complete Auction After Expiration Time", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    {
                        settlementType: "complete",
                    },
                );
            });

            it("Cannot Close Auction Account from Settled Auction None Before Expiration Time", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    {
                        settlementType: "none",
                        waitToExpiration: false,
                        errorMsg: "Error Code: CannotCloseAuctionYet",
                    },
                );
            });

            it("Cannot Close Auction Account from Settled Auction None with Beneficiary Token != Fee Recipient Token", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                        beneficiary: payer.publicKey,
                    },
                    {
                        settlementType: "none",
                        errorMsg: "beneficiary_token. Error Code: ConstraintAddress",
                    },
                );
            });

            it("Cannot Close Auction Account from Settled Auction None with Beneficiary != Fee Recipient", async function () {
                const { feeRecipientToken } = await engine.fetchCustodian();
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                        beneficiary: payer.publicKey,
                        beneficiaryToken: feeRecipientToken,
                    },
                    { settlementType: "none", errorMsg: "Error Code: ConstraintTokenOwner" },
                );
            });

            it("Close Auction Account from Settled Auction None", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    { settlementType: "none" },
                );
            });

            it("Cannot Create New Auction History with Current History Not Full", async function () {
                await createNewAuctionHistoryForTest(
                    {
                        payer: payer.publicKey,
                        currentHistory: engine.auctionHistoryAddress(0),
                    },
                    { errorMsg: "Error Code: AuctionHistoryNotFull" },
                );
            });

            it("Add Another Entry from Settled Complete Auction", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    {
                        settlementType: "complete",
                    },
                );
            });

            it("Cannot Add Another Entry from Settled Complete Auction To Full History", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(0),
                    },
                    {
                        settlementType: "complete",
                        errorMsg: "Error Code: AuctionHistoryFull",
                    },
                );
            });

            it("Create New Auction History", async function () {
                await createNewAuctionHistoryForTest({
                    payer: payer.publicKey,
                    currentHistory: engine.auctionHistoryAddress(0),
                });
            });

            it("Add Another Entry from Settled Complete Auction To New History", async function () {
                await addAuctionHistoryEntryForTest(
                    {
                        payer: payer.publicKey,
                        history: engine.auctionHistoryAddress(1),
                    },
                    {
                        settlementType: "complete",
                    },
                );
            });

            async function createFirstAuctionHistoryForTest(
                accounts: { payer: PublicKey; firstHistory?: PublicKey },
                opts: ForTestOpts = {},
            ) {
                let [{ signers, errorMsg }] = setDefaultForTestOpts(opts);

                const ix = await engine.program.methods
                    .createFirstAuctionHistory()
                    .accounts(createFirstAuctionHistoryAccounts(accounts))
                    .instruction();

                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], signers, errorMsg);
                }

                const auctionHistory = engine.auctionHistoryAddress(0);
                {
                    const accInfo = await connection.getAccountInfo(auctionHistory);
                    expect(accInfo).is.null;
                }

                await expectIxOk(connection, [ix], signers);

                const firstHistoryData = await engine.fetchAuctionHistory({
                    address: auctionHistory,
                });
                expect(firstHistoryData).to.eql(
                    new AuctionHistory(
                        {
                            id: uint64ToBN(0),
                            minTimestamp: null,
                            maxTimestamp: null,
                        },
                        [],
                    ),
                );

                return { auctionHistory };
            }

            function createFirstAuctionHistoryAccounts(accounts: {
                payer: PublicKey;
                firstHistory?: PublicKey;
            }) {
                const { payer } = accounts;
                let { firstHistory } = accounts;
                firstHistory ??= engine.auctionHistoryAddress(0);

                return {
                    payer,
                    firstHistory,
                    systemProgram: SystemProgram.programId,
                };
            }

            async function createNewAuctionHistoryForTest(
                accounts: { payer: PublicKey; currentHistory: PublicKey; newHistory?: PublicKey },
                opts: ForTestOpts = {},
            ) {
                let [{ signers, errorMsg }] = setDefaultForTestOpts(opts);

                const definedAccounts = await createNewAuctionHistoryAccounts(accounts);

                const ix = await engine.program.methods
                    .createNewAuctionHistory()
                    .accounts(definedAccounts)
                    .instruction();

                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], signers, errorMsg);
                }

                const { newHistory } = definedAccounts;
                {
                    const accInfo = await connection.getAccountInfo(newHistory);
                    expect(accInfo).is.null;
                }

                await expectIxOk(connection, [ix], signers);

                const [{ id }, numEntries] = await engine.fetchAuctionHistoryHeader({
                    address: definedAccounts.currentHistory,
                });
                expect(numEntries).equals(2);

                const newHistoryData = await engine.fetchAuctionHistory({
                    address: newHistory,
                });
                expect(newHistoryData).to.eql(
                    new AuctionHistory(
                        {
                            id: uint64ToBN(id.addn(1)),
                            minTimestamp: null,
                            maxTimestamp: null,
                        },
                        [],
                    ),
                );

                return { newHistory };
            }

            async function createNewAuctionHistoryAccounts(accounts: {
                payer: PublicKey;
                currentHistory: PublicKey;
                newHistory?: PublicKey;
            }) {
                const { payer, currentHistory } = accounts;

                const newHistory = await (async () => {
                    if (accounts.newHistory !== undefined) {
                        return accounts.newHistory;
                    } else {
                        const [header] = await engine.fetchAuctionHistoryHeader({
                            address: currentHistory,
                        });
                        return engine.auctionHistoryAddress(header.id.addn(1));
                    }
                })();

                return {
                    payer,
                    currentHistory,
                    newHistory,
                    systemProgram: SystemProgram.programId,
                };
            }

            async function addAuctionHistoryEntryForTest(
                accounts: {
                    payer: PublicKey;
                    auction?: PublicKey;
                    history: PublicKey;
                    beneficiary?: PublicKey;
                    beneficiaryToken?: PublicKey;
                },
                opts: ForTestOpts &
                    ObserveCctpOrderVaasOpts &
                    PrepareOrderResponseForTestOptionalOpts & {
                        settlementType?: "complete" | "none" | null;
                        waitToExpiration?: boolean;
                    } = {},
            ) {
                let [{ signers, errorMsg }, excludedForTestOpts] = setDefaultForTestOpts(opts);
                let { settlementType, waitToExpiration } = excludedForTestOpts;
                settlementType ??= null;
                // Set timestamps to 2 seconds before auction expiration so we don't have to wait
                // too long.
                waitToExpiration ??= true;

                const timeToWait = 5;

                // TODO: add complete auction here
                const auction = await (async () => {
                    if (accounts.auction !== undefined) {
                        return accounts.auction;
                    } else {
                        const timestamp = await getBlockTime(connection);
                        const vaaTimestamp = timestamp - 7200 + timeToWait;
                        if (settlementType == "complete") {
                            const result = await settleAuctionCompleteForTest(
                                { executor: playerOne.publicKey },
                                { vaaTimestamp, prepareSigners: [playerOne] },
                            );
                            return result!.auction;
                        } else if (settlementType == "none") {
                            const result = await settleAuctionNoneCctpForTest(
                                { payer: payer.publicKey },
                                { vaaTimestamp },
                            );
                            return result!.auction;
                        } else {
                            throw new Error("Must specify auction");
                        }
                    }
                })();

                if (waitToExpiration) {
                    const current = await getBlockTime(connection);
                    await waitUntilTimestamp(connection, current + timeToWait);
                }

                const { beneficiary, beneficiaryToken } = await (async () => {
                    if (accounts.beneficiary !== undefined) {
                        return {
                            beneficiary: accounts.beneficiary,
                            beneficiaryToken:
                                accounts.beneficiaryToken ??
                                splToken.getAssociatedTokenAddressSync(
                                    USDC_MINT_ADDRESS,
                                    accounts.beneficiary,
                                ),
                        };
                    } else {
                        const { info } = await engine.fetchAuction({ address: auction });
                        const beneficiaryToken = await (async () => {
                            if (info === null) {
                                const custodian = await engine.fetchCustodian();
                                return custodian.feeRecipientToken;
                            } else {
                                return info!.initialOfferToken;
                            }
                        })();
                        const { owner } = await splToken.getAccount(connection, beneficiaryToken);
                        return {
                            beneficiary: owner,
                            beneficiaryToken: accounts.beneficiaryToken ?? beneficiaryToken,
                        };
                    }
                })();

                const { vaaHash, vaaTimestamp, info } = await engine.fetchAuction({
                    address: auction,
                });
                expect(info === null).equals(settlementType === "none");

                const ix = await engine.program.methods
                    .addAuctionHistoryEntry()
                    .accounts({
                        ...accounts,
                        auction,
                        beneficiary,
                        beneficiaryToken,
                        custodian: engine.checkedCustodianComposite(),
                        systemProgram: SystemProgram.programId,
                    })
                    .instruction();

                if (errorMsg !== null) {
                    return expectIxErr(connection, [ix], signers, errorMsg);
                }

                const beneficiaryBalanceBefore = await connection.getBalance(beneficiary);

                const expectedLamports = await connection
                    .getAccountInfo(auction)
                    .then((info) => info!.lamports);
                const historyDataBefore = await engine.fetchAuctionHistory({
                    address: accounts.history,
                });
                const { header } = historyDataBefore;

                const minTimestamp =
                    header.minTimestamp === null
                        ? vaaTimestamp
                        : Math.min(vaaTimestamp, header.minTimestamp);
                const maxTimestamp =
                    header.maxTimestamp === null
                        ? vaaTimestamp
                        : Math.max(vaaTimestamp, header.maxTimestamp);

                const prevDataLen = await connection
                    .getAccountInfo(accounts.history)
                    .then((info) => info!.data.length);

                await expectIxOk(connection, [ix], signers);

                const historyData = await engine.fetchAuctionHistory({
                    address: accounts.history,
                });

                if (settlementType === "none") {
                    expect(historyData).to.eql(historyDataBefore);
                } else {
                    const data = Array.from(historyDataBefore.data);
                    data.push({
                        vaaHash,
                        vaaTimestamp,
                        info: info!,
                    });
                    expect(historyData).to.eql(
                        new AuctionHistory({ id: header.id, minTimestamp, maxTimestamp }, data),
                    );

                    {
                        const accInfo = await connection.getAccountInfo(accounts.history);

                        let entrySize = 159;
                        if (info!.destinationAssetInfo === null) {
                            entrySize -= 9;
                        }
                        expect(accInfo!.data).has.length(prevDataLen + entrySize);
                    }
                }

                {
                    const accInfo = await connection.getAccountInfo(auction);
                    expect(accInfo).is.null;
                }

                const beneficiaryBalanceAfter = await connection.getBalance(beneficiary);
                expect(beneficiaryBalanceAfter - beneficiaryBalanceBefore).equals(expectedLamports);
            }
        });
    });

    async function placeInitialOfferCctpForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            offerToken?: PublicKey;
            auction?: PublicKey;
            auctionConfig?: PublicKey;
            fromRouterEndpoint?: PublicKey;
            toRouterEndpoint?: PublicKey;
        },
        opts: ForTestOpts &
            ObserveCctpOrderVaasOpts & {
                args?: {
                    offerPrice?: bigint;
                    totalDeposit?: bigint | undefined;
                };
            } = {},
    ): Promise<void | {
        fastVaa: PublicKey;
        fastVaaAccount: VaaAccount;
        txDetails: VersionedTransactionResponse;
        auction: PublicKey;
        auctionDataBefore: Auction;
    }> {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let { args } = excludedForTestOpts;
        args ??= {};

        const { fast, finalized } = await (async () => {
            if (accounts.fastVaa !== undefined) {
                const vaaAccount = await VaaAccount.fetch(connection, accounts.fastVaa);
                return { fast: { vaa: accounts.fastVaa, vaaAccount }, finalized: undefined };
            } else {
                return observeCctpOrderVaas(excludedForTestOpts);
            }
        })();

        try {
            const { fastMarketOrder } = LiquidityLayerMessage.decode(fast.vaaAccount.payload());
            if (fastMarketOrder !== undefined) {
                args.offerPrice ??= fastMarketOrder!.maxFee;
            }
        } catch (e) {
            // Ignore if parsing failed.
        }

        if (args.offerPrice === undefined) {
            throw new Error("offerPrice must be defined");
        }

        // Place the initial offer.
        const ixs = await engine.placeInitialOfferCctpIx(
            { ...accounts, fastVaa: fast.vaa },
            {
                offerPrice: args.offerPrice,
                totalDeposit: args.totalDeposit,
            },
        );

        if (errorMsg !== null) {
            return expectIxErr(connection, ixs, signers, errorMsg);
        }

        const offerToken =
            accounts.offerToken ??
            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, accounts.payer);
        const { owner: participant } = await splToken.getAccount(connection, offerToken);
        expect(offerToken).to.eql(
            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, participant),
        );

        const { amount: offerTokenBalanceBefore } = await splToken.getAccount(
            connection,
            offerToken,
        );

        const vaaHash = fast.vaaAccount.digest();
        const auction = engine.auctionAddress(vaaHash);
        const auctionCustodyBalanceBefore = await engine.fetchAuctionCustodyTokenBalance(auction);

        const txDetails = await expectIxOkDetails(connection, ixs, signers);
        if (txDetails === null) {
            throw new Error("Transaction details are null");
        }
        const auctionDataBefore = await engine.fetchAuction({ address: auction });

        // Validate balance changes.
        const { amount: offerTokenBalanceAfter } = await splToken.getAccount(
            connection,
            offerToken,
        );

        const auctionCustodyBalanceAfter = await engine.fetchAuctionCustodyTokenBalance(auction);

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fast.vaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;
        const { amountIn, maxFee, targetChain, redeemerMessage } = fastMarketOrder!;

        const auctionData = await engine.fetchAuction({ address: auction });
        const { bump, info } = auctionData;
        const { custodyTokenBump, securityDeposit } = info!;

        const { auctionConfigId } = await engine.fetchCustodian();
        const notionalDeposit = await engine.computeNotionalSecurityDeposit(
            amountIn,
            auctionConfigId,
        );
        expect(uint64ToBigInt(securityDeposit)).equals(maxFee + notionalDeposit);

        const balanceChange = amountIn + uint64ToBigInt(securityDeposit);
        expect(offerTokenBalanceAfter).equals(offerTokenBalanceBefore - balanceChange);
        expect(auctionCustodyBalanceAfter).equals(auctionCustodyBalanceBefore + balanceChange);

        // Confirm the auction data.
        const destinationDomain = CHAIN_TO_DOMAIN[toChain(targetChain)];
        expect(destinationDomain).is.not.undefined;

        const expectedAmountIn = uint64ToBN(amountIn);
        expect(auctionData).to.eql(
            new Auction(
                bump,
                Array.from(vaaHash),
                fast.vaaAccount.timestamp(),
                { cctp: { domain: destinationDomain! } },
                { active: {} },
                accounts.payer,
                {
                    configId: auctionConfigId,
                    custodyTokenBump,
                    vaaSequence: uint64ToBN(fast.vaaAccount.emitterInfo().sequence),
                    sourceChain: ethChain,
                    bestOfferToken: offerToken,
                    initialOfferToken: offerToken,
                    startSlot: uint64ToBN(txDetails.slot),
                    amountIn: expectedAmountIn,
                    securityDeposit,
                    offerPrice: uint64ToBN(args.offerPrice),
                    redeemerMessageLen: redeemerMessage.length,
                    destinationAssetInfo: null,
                },
            ),
        );

        return {
            fastVaa: fast.vaa,
            fastVaaAccount: fast.vaaAccount,
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
        const newOffer = uint64ToBigInt(auctionData.info!.offerPrice.subn(improveBy));

        const ixs = await engine.improveOfferIx(
            {
                auction,
                participant: participant.publicKey,
            },
            { offerPrice: newOffer },
        );

        // Improve the bid with offer one.
        await expectIxOk(connection, ixs, [participant]);

        const auctionDataBefore = await engine.fetchAuction({ address: auction });
        expect(uint64ToBigInt(auctionDataBefore.info!.offerPrice)).equals(newOffer);

        return {
            auctionDataBefore,
        };
    }

    type ForTestOpts = {
        signers?: Signer[];
        errorMsg?: string | null;
    };

    function setDefaultForTestOpts<T extends ForTestOpts>(
        opts: T,
    ): [{ signers: Signer[]; errorMsg: string | null }, Omit<T, keyof ForTestOpts>] {
        let { signers, errorMsg } = opts;
        signers ??= [payer];
        delete opts.signers;

        errorMsg ??= null;
        delete opts.errorMsg;

        return [{ signers, errorMsg }, { ...opts }];
    }

    type PrepareOrderResponseForTestOptionalOpts = {
        args?: CctpMessageArgs;
        placeInitialOffer?: boolean;
        numImproveOffer?: number;
        executeOrder?: boolean;
        executeWithinGracePeriod?: boolean;
        prepareAfterExecuteOrder?: boolean;
        instructionOnly?: boolean;
        alreadyPrepared?: boolean;
    };

    async function prepareOrderResponseCctpForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            finalizedVaa?: PublicKey;
        },
        opts: ForTestOpts & ObserveCctpOrderVaasOpts & PrepareOrderResponseForTestOptionalOpts = {},
    ): Promise<void | {
        fastVaa: PublicKey;
        finalizedVaa: PublicKey;
        args: CctpMessageArgs;
        preparedOrderResponse: PublicKey;
        prepareOrderResponseInstruction?: TransactionInstruction;
    }> {
        let [{ signers, errorMsg }, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let {
            args,
            placeInitialOffer,
            numImproveOffer,
            executeOrder,
            executeWithinGracePeriod,
            prepareAfterExecuteOrder,
            instructionOnly,
            alreadyPrepared,
        } = excludedForTestOpts;
        placeInitialOffer ??= true;
        numImproveOffer ??= 0;
        executeOrder ??= placeInitialOffer;
        executeWithinGracePeriod ??= true;
        prepareAfterExecuteOrder ??= true;
        instructionOnly ??= false;
        alreadyPrepared ??= false;

        const { fastVaa, fastVaaAccount, finalizedVaa } = await (async () => {
            const { fastVaa, finalizedVaa } = accounts;

            if (fastVaa !== undefined && finalizedVaa !== undefined && args !== undefined) {
                const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);
                return {
                    fastVaa,
                    fastVaaAccount,
                    finalizedVaa,
                };
            } else if (fastVaa === undefined && finalizedVaa === undefined) {
                const { fast, finalized } = await observeCctpOrderVaas(excludedForTestOpts);
                args ??= finalized!.cctp;

                return {
                    fastVaa: fast.vaa,
                    fastVaaAccount: fast.vaaAccount,
                    finalizedVaa: finalized!.vaa,
                };
            } else {
                throw new Error(
                    "either all of fastVaa, finalizedVaa and args must be provided or neither",
                );
            }
        })();

        const { value: lookupTableAccount } = await connection.getAddressLookupTable(
            lookupTableAddress,
        );

        const placeAndExecute = async () => {
            if (placeInitialOffer) {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                        fastVaa,
                    },
                    {
                        signers: [playerOne],
                    },
                );

                if (executeOrder) {
                    // TODO: replace with executeOfferForTest
                    const auction = result!.auction;
                    const { info } = await engine.fetchAuction({ address: auction });
                    if (info === null) {
                        throw new Error("No auction info found");
                    }
                    const { configId, bestOfferToken, initialOfferToken, startSlot } = info;
                    const auctionConfig = engine.auctionConfigAddress(configId);
                    const { duration, gracePeriod, penaltyPeriod } =
                        await engine.fetchAuctionParameters(configId);

                    const endSlot = (() => {
                        if (executeWithinGracePeriod) {
                            return startSlot.addn(duration + gracePeriod - 1).toNumber();
                        } else {
                            return startSlot
                                .addn(duration + gracePeriod + penaltyPeriod - 1)
                                .toNumber();
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
                    await expectIxOk(connection, [computeIx, ix], [payer], {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    });
                }
            }
        };

        if (prepareAfterExecuteOrder) {
            await placeAndExecute();
        }

        const ix = await engine.prepareOrderResponseCctpIx(
            {
                payer: accounts.payer,
                fastVaa,
                finalizedVaa,
            },
            args!,
        );

        if (errorMsg !== null) {
            expect(instructionOnly).is.false;
            return expectIxErr(connection, [ix], signers, errorMsg, {
                addressLookupTableAccounts: [lookupTableAccount!],
            });
        }

        const preparedOrderResponse = engine.preparedOrderResponseAddress(fastVaaAccount.digest());
        const preparedOrderResponseBefore = await (async () => {
            if (alreadyPrepared) {
                return engine.fetchPreparedOrderResponse({ address: preparedOrderResponse });
            } else {
                const accInfo = await connection.getAccountInfo(preparedOrderResponse);
                expect(accInfo).is.null;
                return null;
            }
        })();

        if (instructionOnly) {
            return {
                fastVaa,
                finalizedVaa,
                args: args!,
                preparedOrderResponse,
                prepareOrderResponseInstruction: ix,
            };
        }

        const preparedCustodyToken = engine.preparedCustodyTokenAddress(preparedOrderResponse);
        {
            const accInfo = await connection.getAccountInfo(preparedCustodyToken);
            expect(accInfo !== null).equals(alreadyPrepared);
        }

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 280_000,
        });
        await expectIxOk(connection, [computeIx, ix], signers, {
            addressLookupTableAccounts: [lookupTableAccount!],
        });

        if (!prepareAfterExecuteOrder) {
            await placeAndExecute();
        }

        const preparedOrderResponseData = await engine.fetchPreparedOrderResponse({
            address: preparedOrderResponse,
        });
        const { seeds } = preparedOrderResponseData;

        const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
        const { deposit } = LiquidityLayerMessage.decode(finalizedVaaAccount.payload());
        expect(deposit).is.not.undefined;

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;

        const toEndpoint = await engine.fetchRouterEndpointInfo(
            toChainId(fastMarketOrder!.targetChain),
        );

        const { baseFee } = deposit!.message.payload! as SlowOrderResponse;
        expect(preparedOrderResponseData).to.eql(
            new PreparedOrderResponse(
                {
                    fastVaaHash: Array.from(fastVaaAccount.digest()),
                    bump: seeds.bump,
                },
                {
                    preparedBy: accounts.payer,
                    fastVaaTimestamp: fastVaaAccount.timestamp(),
                    sourceChain: fastVaaAccount.emitterInfo().chain,
                    baseFee: uint64ToBN(baseFee),
                    initAuctionFee: uint64ToBN(fastMarketOrder!.initAuctionFee),
                    sender: Array.from(fastMarketOrder!.sender.toUint8Array()),
                    redeemer: Array.from(fastMarketOrder!.redeemer.toUint8Array()),
                    amountIn: uint64ToBN(fastMarketOrder!.amountIn),
                },
                toEndpoint,
                Buffer.from(fastMarketOrder!.redeemerMessage),
            ),
        );
        if (preparedOrderResponseBefore) {
            expect(preparedOrderResponseData).to.eql(preparedOrderResponseBefore);
        }

        {
            const token = await splToken.getAccount(connection, preparedCustodyToken);
            expect(token.amount).equals(fastMarketOrder!.amountIn);
        }

        {
            const token = await splToken.getAccount(connection, engine.cctpMintRecipientAddress());
            expect(token.amount).equals(0n);
        }

        return {
            fastVaa,
            finalizedVaa,
            args: args!,
            preparedOrderResponse,
        };
    }

    async function settleAuctionCompleteForTest(
        accounts: {
            executor?: PublicKey;
            executorToken?: PublicKey;
            preparedOrderResponse?: PublicKey;
            auction?: PublicKey;
            bestOfferToken?: PublicKey;
        },
        opts: ForTestOpts &
            ObserveCctpOrderVaasOpts &
            PrepareOrderResponseForTestOptionalOpts & {
                executorIsPreparer?: boolean;
                prepareSigners?: Signer[];
                preparedInSameTransaction?: boolean;
            } = {},
    ): Promise<void | { auction: PublicKey }> {
        let [{ signers, errorMsg }, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let { executorIsPreparer, prepareSigners, preparedInSameTransaction } = excludedForTestOpts;
        executorIsPreparer ??= true;
        prepareSigners ??= [playerOne];
        preparedInSameTransaction ??= false; // TODO: do something with this

        if (preparedInSameTransaction) {
            throw new Error("preparedInSameTransaction not implemented");
        }

        const { fastVaa, finalizedVaa, preparedOrderResponse } = await (async () => {
            if (accounts.preparedOrderResponse !== undefined) {
                return {
                    fastVaa: null,
                    finalizedVaa: null,
                    preparedOrderResponse: accounts.preparedOrderResponse,
                };
            } else {
                const result = await prepareOrderResponseCctpForTest(
                    {
                        payer: executorIsPreparer
                            ? accounts.executor ?? playerOne.publicKey
                            : payer.publicKey,
                    },
                    {
                        signers: executorIsPreparer ? prepareSigners : [payer],
                        ...excludedForTestOpts,
                    },
                );
                expect(typeof result == "object" && "preparedOrderResponse" in result).is.true;
                return result!;
            }
        })();

        const executor = accounts.executor ?? playerOne.publicKey;

        const ix = await engine.settleAuctionCompleteIx({
            ...accounts,
            executor,
            preparedOrderResponse,
        });

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        // If we are at this point, we require that prepareOrderResponseForTest be called. So these
        // pubkeys must not be null.
        if (fastVaa === null && finalizedVaa === null) {
            throw new Error("Cannot provide preparedOrderResponse in accounts for successful test");
        }

        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);

        const auction = accounts.auction ?? engine.auctionAddress(fastVaaAccount.digest());
        const { info, status: statusBefore } = await engine.fetchAuction({
            address: auction,
        });

        const { bestOfferToken } = info!;
        const executorToken = splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, executor);
        const { owner: bestOfferAuthority, amount: bestOfferTokenBalanceBefore } =
            await splToken.getAccount(connection, bestOfferToken);

        let executorTokenBalanceBefore: bigint | null = null;
        if ((opts.executeWithinGracePeriod ?? true) || executor.equals(bestOfferAuthority)) {
            expect(accounts.executor).to.eql(bestOfferAuthority);
        } else {
            const {
                info: { preparedBy },
            } = await engine.fetchPreparedOrderResponse({
                address: preparedOrderResponse,
            });
            expect(accounts.executor).to.eql(preparedBy);

            const { amount } = await splToken.getAccount(connection, executorToken);
            executorTokenBalanceBefore = amount;
        }

        const authorityLamportsBefore = await connection.getBalance(executor);

        const preparedCustodyToken = engine.preparedCustodyTokenAddress(preparedOrderResponse);
        const { amount: preparedCustodyBalanceBefore } = await splToken.getAccount(
            connection,
            preparedCustodyToken,
        );

        const preparedOrderLamports = await connection
            .getAccountInfo(preparedOrderResponse)
            .then((info) => info!.lamports);
        const preparedCustodyLamports = await connection
            .getAccountInfo(preparedCustodyToken)
            .then((info) => info!.lamports);

        await expectIxOk(connection, [ix], [payer]);

        {
            const accInfo = await connection.getAccountInfo(preparedCustodyToken);
            expect(accInfo).is.null;
        }
        {
            const accInfo = await connection.getAccountInfo(preparedOrderResponse);
            expect(accInfo).is.null;
        }

        const { amount: bestOfferTokenBalanceAfter } = await splToken.getAccount(
            connection,
            bestOfferToken,
        );
        const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
        const { deposit } = LiquidityLayerMessage.decode(finalizedVaaAccount.payload());
        const { baseFee } = deposit!.message.payload! as SlowOrderResponse;

        if (executorTokenBalanceBefore == null) {
            expect(bestOfferTokenBalanceAfter).equals(
                bestOfferTokenBalanceBefore + preparedCustodyBalanceBefore,
            );
        } else {
            expect(bestOfferTokenBalanceAfter).equals(
                bestOfferTokenBalanceBefore + preparedCustodyBalanceBefore - baseFee,
            );

            const { amount: executorTokenBalanceAfter } = await splToken.getAccount(
                connection,
                executorToken,
            );
            expect(executorTokenBalanceAfter).equals(executorTokenBalanceBefore + baseFee);
        }

        const authorityLamportsAfter = await connection.getBalance(executor);
        expect(authorityLamportsAfter).equals(
            authorityLamportsBefore + preparedOrderLamports + preparedCustodyLamports,
        );

        const { status: statusAfter } = await engine.fetchAuction({
            address: auction,
        });

        const executePenalty = statusBefore.completed!.executePenalty;
        expect(statusAfter).to.eql({
            settled: {
                fee: uint64ToBN(baseFee),
                totalPenalty:
                    executePenalty !== null
                        ? uint64ToBN(executePenalty.add(uint64ToBN(baseFee)))
                        : null,
            },
        });

        return { auction };
    }

    async function settleAuctionNoneCctpForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            preparedOrderResponse?: PublicKey;
            toRouterEndpoint?: PublicKey;
        },
        opts: ForTestOpts &
            ObserveCctpOrderVaasOpts &
            PrepareOrderResponseForTestOptionalOpts & {
                preparedInSameTransaction?: boolean;
            } = {},
    ): Promise<void | { auction: PublicKey }> {
        let [{ signers, errorMsg }, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let { preparedInSameTransaction } = excludedForTestOpts;
        preparedInSameTransaction ??= false; // TODO: do something with this
        if (preparedInSameTransaction) {
            throw new Error("preparedInSameTransaction not implemented");
        }

        const { fastVaa, finalizedVaa, preparedOrderResponse } = await (async () => {
            if (accounts.fastVaa !== undefined && accounts.preparedOrderResponse !== undefined) {
                return {
                    fastVaa: accounts.fastVaa,
                    finalizedVaa: null,
                    preparedOrderResponse: accounts.preparedOrderResponse,
                };
            } else {
                const result = await prepareOrderResponseCctpForTest(
                    {
                        payer: payer.publicKey,
                    },
                    {
                        ...excludedForTestOpts,
                        placeInitialOffer: false,
                    },
                );
                expect(typeof result == "object" && "preparedOrderResponse" in result).is.true;
                return {
                    fastVaa: accounts.fastVaa ?? result!.fastVaa,
                    finalizedVaa: result!.finalizedVaa,
                    preparedOrderResponse:
                        accounts.preparedOrderResponse ?? result!.preparedOrderResponse,
                };
            }
        })();

        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 300_000,
        });

        const ix = await engine.settleAuctionNoneCctpIx({
            ...accounts,
            fastVaa,
            preparedOrderResponse,
        });

        if (errorMsg !== null) {
            return expectIxErr(connection, [computeIx, ix], signers, errorMsg);
        }

        // If we are at this point, we require that prepareOrderResponseForTest be called. So the
        // finalized VAA must not be null.
        if (finalizedVaa === null) {
            throw new Error(
                "Cannot provide fastVaa and preparedOrderResponse in accounts for successful test",
            );
        }

        const { amount: feeBalanceBefore } = await splToken.getAccount(
            connection,
            feeRecipientToken,
        );

        await expectIxOk(connection, [computeIx, ix], signers);

        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);
        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;

        const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
        const {
            message: { payload: slowOrderResponse },
        } = LiquidityLayerMessage.decode(finalizedVaaAccount.payload()).deposit!;
        expect(slowOrderResponse).is.not.undefined;

        const fee =
            (slowOrderResponse! as SlowOrderResponse).baseFee + fastMarketOrder!.initAuctionFee;

        const { amount: feeBalanceAfter } = await splToken.getAccount(
            connection,
            feeRecipientToken,
        );
        expect(feeBalanceAfter).equals(feeBalanceBefore + fee);

        {
            const preparedCustodyToken = engine.preparedCustodyTokenAddress(preparedOrderResponse);
            const accInfo = await connection.getAccountInfo(preparedCustodyToken);
            expect(accInfo).is.null;
        }

        const destinationDomain = CHAIN_TO_DOMAIN[toChain(fastMarketOrder!.targetChain)];
        expect(destinationDomain).is.not.undefined;

        const fastVaaHash = fastVaaAccount.digest();
        const auction = engine.auctionAddress(fastVaaHash);
        const auctionData = await engine.fetchAuction({ address: auction });
        const { bump, preparedBy, info } = auctionData;
        expect(info).is.null;

        expect(auctionData).to.eql(
            new Auction(
                bump,
                Array.from(fastVaaHash),
                fastVaaAccount.timestamp(),
                { cctp: { domain: destinationDomain! } },
                {
                    settled: {
                        fee: uint64ToBN(fee),
                        totalPenalty: null,
                    },
                },
                preparedBy,
                null,
            ),
        );

        return { auction };
    }

    function newFastMarketOrder(
        args: {
            amountIn?: bigint;
            minAmountOut?: bigint;
            initAuctionFee?: bigint;
            targetChain?: Chain;
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
            targetChain: targetChain ?? "Arbitrum",
            redeemer: toUniversalAddress(new Array(32).fill(1)),
            sender: toUniversalAddress(new Array(32).fill(2)),
            refundAddress: toUniversalAddress(new Array(32).fill(3)),
            maxFee: maxFee ?? 42069n,
            initAuctionFee: initAuctionFee ?? 1_250_000n,
            deadline: deadline ?? 0,
            redeemerMessage:
                redeemerMessage ?? encoding.bytes.encode("Somebody set up us the bomb"),
        };
    }

    function newSlowOrderResponse(args: { baseFee?: bigint } = {}): SlowOrderResponse {
        const { baseFee } = args;

        return {
            baseFee: baseFee ?? 420n,
        };
    }

    type VaaResult = {
        vaa: PublicKey;
        vaaAccount: VaaAccount;
    };

    type FastObservedResult = VaaResult & {
        fastMarketOrder: FastMarketOrder;
    };

    type FinalizedObservedResult = VaaResult & {
        slowOrderResponse: SlowOrderResponse;
        cctp: CctpMessageArgs;
    };

    type ObserveCctpOrderVaasOpts = {
        sourceChain?: Chain;
        emitter?: Array<number>;
        vaaTimestamp?: number;
        fastMarketOrder?: FastMarketOrder;
        finalized?: boolean;
        slowOrderResponse?: SlowOrderResponse;
        finalizedSourceChain?: Chain;
        finalizedEmitter?: Array<number>;
        finalizedSequence?: bigint;
        finalizedVaaTimestamp?: number;
    };

    async function observeCctpOrderVaas(opts: ObserveCctpOrderVaasOpts = {}): Promise<{
        fast: FastObservedResult;
        finalized?: FinalizedObservedResult;
    }> {
        let {
            sourceChain,
            emitter,
            vaaTimestamp,
            fastMarketOrder,
            finalized,
            slowOrderResponse,
            finalizedSourceChain,
            finalizedEmitter,
            finalizedSequence,
            finalizedVaaTimestamp,
        } = opts;
        sourceChain ??= "Ethereum";
        emitter ??= REGISTERED_TOKEN_ROUTERS[sourceChain] ?? new Array(32).fill(0);
        vaaTimestamp ??= await getBlockTime(connection);
        fastMarketOrder ??= newFastMarketOrder();
        finalized ??= true;
        slowOrderResponse ??= newSlowOrderResponse();
        finalizedSourceChain ??= sourceChain;
        finalizedEmitter ??= emitter;
        finalizedSequence ??= finalized ? wormholeSequence++ : 0n;
        finalizedVaaTimestamp ??= vaaTimestamp;

        const sourceCctpDomain = CHAIN_TO_DOMAIN[sourceChain];
        if (sourceCctpDomain === undefined) {
            throw new Error(`Invalid source chain: ${sourceChain}`);
        }

        const fastVaa = await postLiquidityLayerVaa(
            connection,
            payer,
            MOCK_GUARDIANS,
            emitter,
            wormholeSequence++,
            new LiquidityLayerMessage({
                fastMarketOrder,
            }),
            { sourceChain, timestamp: vaaTimestamp },
        );
        const fastVaaAccount = await VaaAccount.fetch(connection, fastVaa);
        const fast = { fastMarketOrder, vaa: fastVaa, vaaAccount: fastVaaAccount };

        if (finalized) {
            const { amountIn: amount } = fastMarketOrder;
            const cctpNonce = testCctpNonce++;

            // Concoct a Circle message.
            const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                await craftCctpTokenBurnMessage(sourceCctpDomain, cctpNonce, amount);

            const finalizedMessage = new LiquidityLayerMessage({
                deposit: new LiquidityLayerDeposit({
                    tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                    amount,
                    sourceCctpDomain,
                    destinationCctpDomain,
                    cctpNonce,
                    burnSource: toUniversalAddress(Buffer.alloc(32, "beefdead", "hex")),
                    mintRecipient: toUniversalAddress(engine.cctpMintRecipientAddress().toBuffer()),
                    payload: { id: 2, ...slowOrderResponse },
                }),
            });

            const finalizedVaa = await postLiquidityLayerVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                finalizedEmitter,
                finalizedSequence,
                finalizedMessage,
                { sourceChain: finalizedSourceChain, timestamp: finalizedVaaTimestamp },
            );
            const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
            return {
                fast,
                finalized: {
                    slowOrderResponse,
                    vaa: finalizedVaa,
                    vaaAccount: finalizedVaaAccount,
                    cctp: {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
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
            Array.from(toUniversal("Ethereum", ETHEREUM_USDC_ADDRESS).toUint8Array()), // sourceTokenAddress
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
