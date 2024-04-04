import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
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
import { CctpTokenBurnMessage } from "../src/cctp";
import { LiquidityLayerDeposit, LiquidityLayerMessage } from "../src/common";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";
import { VaaAccount } from "../src/wormhole";
import {
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    expectIxOkDetails,
    postLiquidityLayerVaa,
    waitUntilSlot,
} from "./helpers";

chaiUse(chaiAsPromised);

describe("Matching Engine <> Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");

    const payer = PAYER_KEYPAIR;
    const owner = OWNER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const offerAuthorityOne = Keypair.generate();

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(
        connection,
        matchingEngineSdk.localnet(),
        USDC_MINT_ADDRESS,
    );
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.localnet(),
        matchingEngine.mint,
    );
    const liquidator = Keypair.generate();

    let lookupTableAddress: PublicKey;
    const ethRouter = Array.from(Buffer.alloc(32, "deadbeef", "hex"));

    describe("Admin", function () {
        describe("Local Router Endpoint", function () {
            const localVariables = new Map<string, any>();

            it("Matching Engine .. Cannot Add Local Router Endpoint without Executable", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: SYSVAR_RENT_PUBKEY,
                });

                const [bogusEmitter] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    SYSVAR_RENT_PUBKEY,
                );
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    bogusEmitter,
                    true,
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: ConstraintExecutable",
                );
            });

            it("Matching Engine .. Cannot Add Local Router Endpoint using System Program", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: SystemProgram.programId,
                });

                const [bogusEmitter] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    SystemProgram.programId,
                );
                await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    bogusEmitter,
                    true,
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: InvalidEndpoint",
                );
            });

            it("Matching Engine .. Add Local Router Endpoint using Token Router Program", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new matchingEngineSdk.RouterEndpoint(
                        bump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        Array.from(tokenRouter.custodianAddress().toBuffer()),
                        Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer()),
                        { local: { programId: tokenRouter.ID } },
                    ),
                );

                // Save for later.
                localVariables.set("ix", ix);
            });

            it("Matching Engine .. Cannot Add Local Router Endpoint Again", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                const routerEndpoint = matchingEngine.routerEndpointAddress(
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    `Allocate: account Address { address: ${routerEndpoint.toString()}, base: None } already in use`,
                );
            });

            it("Matching Engine .. Cannot Update Router Endpoint as Owner Assistant", async function () {
                const ix = await matchingEngine.updateLocalRouterEndpointIx({
                    owner: ownerAssistant.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            // TODO: This is a no-op. Consider using testnet token router program as the first one
            // registered before registering the localnet one.
            it("Matching Engine .. Update Router Endpoint as Owner", async function () {
                const ix = await matchingEngine.updateLocalRouterEndpointIx({
                    owner: owner.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });

                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new matchingEngineSdk.RouterEndpoint(
                        bump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        Array.from(tokenRouter.custodianAddress().toBuffer()),
                        Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer()),
                        { local: { programId: tokenRouter.ID } },
                    ),
                );
            });

            it("Matching Engine .. Cannot Disable Router Endpoint as Owner Assistant", async function () {
                const ix = await matchingEngine.disableRouterEndpointIx(
                    { owner: ownerAssistant.publicKey },
                    wormholeSdk.CHAIN_ID_SOLANA,
                );

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Matching Engine .. Disable Local Router Endpoint as Owner", async function () {
                const ix = await matchingEngine.disableRouterEndpointIx(
                    {
                        owner: owner.publicKey,
                    },
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new matchingEngineSdk.RouterEndpoint(
                        bump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        new Array(32).fill(0),
                        new Array(32).fill(0),
                        { none: {} },
                    ),
                );
            });

            after("Set Up Lookup Table", async function () {
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    }),
                );
                await expectIxOk(connection, [createIx], [payer]);
                const usdcCommonAccounts = await matchingEngine.commonAccounts();
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

            after("Set Up Offer Authority", async function () {
                const transferIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: offerAuthorityOne.publicKey,
                    lamports: 1000000000,
                });

                const offerToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    offerAuthorityOne.publicKey,
                );
                const createIx = splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    offerToken,
                    offerAuthorityOne.publicKey,
                    USDC_MINT_ADDRESS,
                );
                const mintIx = splToken.createMintToInstruction(
                    USDC_MINT_ADDRESS,
                    offerToken,
                    payer.publicKey,
                    1_000_000_000_000n,
                );
                await expectIxOk(connection, [transferIx, createIx, mintIx], [payer]);
            });
        });
    });

    describe("Business Logic", function () {
        let testCctpNonce = 2n ** 64n - 1n;

        // Hack to prevent math overflow error when invoking CCTP programs.
        testCctpNonce -= 40n * 6400n;

        let wormholeSequence = 4000n;

        describe.skip("Settle Auction", function () {
            describe("Settle No Auction (Local)", function () {
                it("Settle", async function () {
                    const { prepareIx, auction, fastVaa, finalizedVaa } =
                        await prepareOrderResponse({
                            initAuction: false,
                            executeOrder: false,
                            prepareOrderResponse: false,
                        });
                    const settleIx = await matchingEngine.settleAuctionNoneLocalIx({
                        payer: payer.publicKey,
                        fastVaa,
                        auction,
                    });
                    const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                        lookupTableAddress,
                    );

                    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                        units: 400_000,
                    });
                    await expectIxOk(connection, [prepareIx!, settleIx, computeIx], [payer], {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    });
                });
            });

            before("Update Local Router Endpoint", async function () {
                const ix = await matchingEngine.updateLocalRouterEndpointIx({
                    owner: owner.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });
                await expectIxOk(connection, [ix], [owner]);
            });

            after("Disable Local Router Endpoint", async function () {
                const ix = await matchingEngine.disableRouterEndpointIx(
                    {
                        owner: owner.publicKey,
                    },
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                await expectIxOk(connection, [ix], [owner]);
            });
        });

        describe("Execute Fast Order (Local)", function () {
            it("Cannot Execute Fast Order (Auction Period Not Expired)", async function () {
                const { auction: auctionAddress, fastVaa } = await prepareOrderResponse({
                    initAuction: true,
                    executeOrder: false,
                    prepareOrderResponse: false,
                });

                const { address: executorToken } = await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    liquidator.publicKey,
                );

                const settleIx = await matchingEngine.executeFastOrderLocalIx({
                    payer: payer.publicKey,
                    fastVaa,
                    auction: auctionAddress,
                    executorToken,
                });

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 250_000,
                });

                await expectIxErr(
                    connection,
                    [settleIx, computeIx],
                    [payer],
                    "Error Code: AuctionPeriodNotExpired",
                );
            });

            it("Execute after Auction Period has Expired", async function () {
                const { fastMarketOrder, auction, fastVaa } = await prepareOrderResponse({
                    initAuction: true,
                    executeOrder: false,
                    prepareOrderResponse: false,
                });

                const { address: executorToken } = await splToken.getOrCreateAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    liquidator.publicKey,
                );

                const { info } = await matchingEngine.fetchAuction({ address: auction });
                const { duration, gracePeriod } = await matchingEngine.fetchAuctionParameters();

                await waitUntilSlot(
                    connection,
                    info!.startSlot.addn(duration + gracePeriod - 1).toNumber(),
                );

                const auctionCustodyTokenBalanceBefore =
                    await matchingEngine.fetchAuctionCustodyTokenBalance(auction);
                const localCustodyTokenBalanceBefore =
                    await matchingEngine.fetchLocalCustodyTokenBalance(foreignChain);
                expect(localCustodyTokenBalanceBefore).equals(0n);

                const ix = await matchingEngine.executeFastOrderLocalIx({
                    payer: payer.publicKey,
                    fastVaa,
                    auction,
                    executorToken,
                });

                const txDetails = await expectIxOkDetails(connection, [ix], [payer]);

                const auctionCustodyTokenBalanceAfter =
                    await matchingEngine.fetchAuctionCustodyTokenBalance(auction);
                expect(auctionCustodyTokenBalanceAfter).equals(0n);
                const localCustodyTokenBalanceAfter =
                    await matchingEngine.fetchLocalCustodyTokenBalance(foreignChain);

                const { penalty, userReward } = await matchingEngine.computeDepositPenalty(
                    info!,
                    BigInt(txDetails!.slot),
                    info!.configId,
                );
                const { amountIn, maxFee: offerPrice, initAuctionFee } = fastMarketOrder;
                const userAmount = amountIn - offerPrice - initAuctionFee + userReward;
                expect(localCustodyTokenBalanceAfter).equals(userAmount);
            });

            before("Update Local Router Endpoint", async function () {
                const ix = await matchingEngine.updateLocalRouterEndpointIx({
                    owner: owner.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });
                await expectIxOk(connection, [ix], [owner]);
            });

            after("Disable Local Router Endpoint", async function () {
                const ix = await matchingEngine.disableRouterEndpointIx(
                    {
                        owner: owner.publicKey,
                    },
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                await expectIxOk(connection, [ix], [owner]);
            });
        });

        describe("Redeem Fast Fill", function () {
            const payerToken = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                payer.publicKey,
            );

            const orderSender = Array.from(Buffer.alloc(32, "d00d", "hex"));
            const redeemer = Keypair.generate();

            const localVariables = new Map<string, any>();

            it("Token Router ..... Cannot Redeem Fast Fill without Local Router Endpoint", async function () {
                const amount = 69n;
                const redeemerMessage = Buffer.from("Somebody set up us the bomb");
                const message = new LiquidityLayerMessage({
                    fastFill: {
                        fill: {
                            sourceChain: foreignChain,
                            orderSender,
                            redeemer: Array.from(redeemer.publicKey.toBuffer()),
                            redeemerMessage,
                        },
                        amount,
                    },
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    Array.from(matchingEngine.custodianAddress().toBuffer()),
                    wormholeSequence++,
                    message,
                    { sourceChain: "solana" },
                );

                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: EndpointDisabled");

                // Save for later.
                localVariables.set("vaa", vaa);
                localVariables.set("amount", amount);
                localVariables.set("redeemerMessage", redeemerMessage);
            });

            it("Matching Engine .. Update Local Router Endpoint using Token Router Program", async function () {
                const ix = await matchingEngine.updateLocalRouterEndpointIx({
                    owner: owner.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });
                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    wormholeSdk.CHAIN_ID_SOLANA,
                );
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new matchingEngineSdk.RouterEndpoint(
                        bump,
                        wormholeSdk.CHAIN_ID_SOLANA,
                        Array.from(tokenRouter.custodianAddress().toBuffer()),
                        Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer()),
                        { local: { programId: tokenRouter.ID } },
                    ),
                );
            });

            it("Token Router ..... Redeem Fast Fill", async function () {
                const vaa = localVariables.get("vaa") as PublicKey;
                const amount = localVariables.get("amount") as bigint;
                const redeemerMessage = localVariables.get("redeemerMessage") as Buffer;

                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxOk(connection, [ix], [payer]);

                // Check balance. TODO

                const vaaHash = await VaaAccount.fetch(connection, vaa).then((vaa) => vaa.digest());
                const preparedFill = tokenRouter.preparedFillAddress(vaaHash);

                // Check redeemed fast fill account.
                const redeemedFastFill = matchingEngine.redeemedFastFillAddress(vaaHash);
                const redeemedFastFillData = await matchingEngine.fetchRedeemedFastFill({
                    address: redeemedFastFill,
                });

                // The VAA hash can change depending on the message (sequence is usually the reason for
                // this). So we just take the bump from the fetched data and move on with our lives.
                {
                    const { bump } = redeemedFastFillData;
                    expect(redeemedFastFillData).to.eql(
                        new matchingEngineSdk.RedeemedFastFill(
                            bump,
                            Array.from(vaaHash),
                            new BN(new BN(wormholeSequence.toString()).subn(1).toBuffer("be", 8)),
                        ),
                    );
                }

                {
                    const preparedFillData = await tokenRouter.fetchPreparedFill(preparedFill);
                    const {
                        info: { bump, preparedCustodyTokenBump },
                    } = preparedFillData;
                    expect(preparedFillData).to.eql(
                        new tokenRouterSdk.PreparedFill(
                            {
                                vaaHash: Array.from(vaaHash),
                                bump,
                                preparedCustodyTokenBump,
                                redeemer: redeemer.publicKey,
                                preparedBy: payer.publicKey,
                                fillType: { fastFill: {} },
                                sourceChain: foreignChain,
                                orderSender,
                            },
                            redeemerMessage,
                        ),
                    );
                }

                // Save for later.
                localVariables.set("redeemedFastFill", redeemedFastFill);
                localVariables.set("preparedFill", preparedFill);
            });

            it("Token Router ..... Redeem Same Fast Fill is No-op", async function () {
                const vaa = localVariables.get("vaa") as PublicKey;

                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxOk(connection, [ix], [payer]);
            });

            it("Token Router ..... Consume Prepared Fill for Fast Fill", async function () {
                const preparedFill = localVariables.get("preparedFill") as PublicKey;
                expect(localVariables.delete("preparedFill")).is.true;

                const amount = localVariables.get("amount") as bigint;
                expect(localVariables.delete("amount")).is.true;

                const redeemerMessage = localVariables.get("redeemerMessage") as Buffer;
                expect(localVariables.delete("redeemerMessage")).is.true;

                const beneficiary = Keypair.generate().publicKey;
                const ix = await tokenRouter.consumePreparedFillIx({
                    preparedFill,
                    redeemer: redeemer.publicKey,
                    dstToken: payerToken,
                    beneficiary,
                });

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);
                const solBalanceBefore = await connection.getBalance(beneficiary);

                await expectIxOk(connection, [ix], [payer, redeemer]);

                // Check balance.
                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore + amount);

                const solBalanceAfter = await connection.getBalance(beneficiary);
                const preparedFillRent = await connection.getMinimumBalanceForRentExemption(
                    152 + redeemerMessage.length,
                );
                const preparedTokenRent = await connection.getMinimumBalanceForRentExemption(
                    splToken.AccountLayout.span,
                );
                expect(solBalanceAfter).equals(
                    solBalanceBefore + preparedFillRent + preparedTokenRent,
                );

                const accInfo = await connection.getAccountInfo(preparedFill);
                expect(accInfo).is.null;
            });

            it("Token Router ..... Cannot Redeem Same Fast Fill Again", async function () {
                const vaa = localVariables.get("vaa") as PublicKey;
                expect(localVariables.delete("vaa")).is.true;

                const redeemedFastFill = localVariables.get("redeemedFastFill") as PublicKey;
                expect(localVariables.delete("redeemedFastFill")).is.true;

                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    `Allocate: account Address { address: ${redeemedFastFill.toString()}, base: None } already in use`,
                );
            });

            it("Token Router ..... Cannot Redeem Fast Fill with Emitter Chain ID != Solana", async function () {
                const amount = 69n;
                const message = new LiquidityLayerMessage({
                    fastFill: {
                        fill: {
                            sourceChain: foreignChain,
                            orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                            redeemer: new Array(32).fill(0),
                            redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                        },
                        amount,
                    },
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    Array.from(matchingEngine.custodianAddress().toBuffer()),
                    wormholeSequence++,
                    message,
                    { sourceChain: "avalanche" },
                );
                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: InvalidEmitterForFastFill",
                );
            });

            it("Token Router ..... Cannot Redeem Fast Fill with Emitter Address != Matching Engine Custodian", async function () {
                const amount = 69n;
                const message = new LiquidityLayerMessage({
                    fastFill: {
                        fill: {
                            sourceChain: foreignChain,
                            orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                            redeemer: new Array(32).fill(0),
                            redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                        },
                        amount,
                    },
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    wormholeSequence++,
                    message,
                    { sourceChain: "solana" },
                );
                const ix = await tokenRouter.redeemFastFillIx({
                    payer: payer.publicKey,
                    vaa,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: InvalidEmitterForFastFill",
                );
            });

            it("Token Router ..... Cannot Redeem Fast Fill with Invalid VAA", async function () {
                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    Array.from(matchingEngine.custodianAddress().toBuffer()),
                    wormholeSequence++,
                    Buffer.from("Oh noes!"), // message
                    { sourceChain: "solana" },
                );

                const {
                    custodian,
                    preparedFill,
                    matchingEngineCustodian,
                    matchingEngineRedeemedFastFill,
                    matchingEngineFromEndpoint,
                    matchingEngineToEndpoint,
                    matchingEngineLocalCustodyToken,
                    matchingEngineProgram,
                } = await tokenRouter.redeemFastFillAccounts(vaa, foreignChain);

                const ix = await tokenRouter.program.methods
                    .redeemFastFill()
                    .accounts({
                        custodian: { custodian },
                        preparedFill: tokenRouter.initIfNeededPreparedFillComposite({
                            payer: payer.publicKey,
                            vaa,
                            preparedFill,
                        }),
                        matchingEngineCustodian,
                        matchingEngineRedeemedFastFill,
                        matchingEngineFromEndpoint,
                        matchingEngineToEndpoint,
                        matchingEngineLocalCustodyToken,
                        matchingEngineProgram,
                    })
                    .instruction();

                await expectIxErr(connection, [ix], [payer], "Error Code: InvalidVaa");
            });

            it("Token Router ..... Cannot Redeem Fast Fill with Invalid Payload", async function () {
                const amount = 69n;
                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit(
                        {
                            tokenAddress: new Array(32).fill(0),
                            amount,
                            sourceCctpDomain: 69,
                            destinationCctpDomain: 69,
                            cctpNonce: 69n,
                            burnSource: new Array(32).fill(0),
                            mintRecipient: new Array(32).fill(0),
                        },
                        {
                            fill: {
                                sourceChain: foreignChain,
                                orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                                redeemer: new Array(32).fill(0),
                                redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                            },
                        },
                    ),
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    Array.from(matchingEngine.custodianAddress().toBuffer()),
                    wormholeSequence++,
                    message,
                    { sourceChain: "solana" },
                );

                const {
                    custodian,
                    preparedFill,
                    matchingEngineCustodian,
                    matchingEngineRedeemedFastFill,
                    matchingEngineFromEndpoint,
                    matchingEngineToEndpoint,
                    matchingEngineLocalCustodyToken,
                    matchingEngineProgram,
                } = await tokenRouter.redeemFastFillAccounts(vaa, foreignChain);

                const ix = await tokenRouter.program.methods
                    .redeemFastFill()
                    .accounts({
                        custodian: { custodian },
                        preparedFill: tokenRouter.initIfNeededPreparedFillComposite({
                            payer: payer.publicKey,
                            vaa,
                            preparedFill,
                        }),
                        matchingEngineCustodian,
                        matchingEngineRedeemedFastFill,
                        matchingEngineFromEndpoint,
                        matchingEngineToEndpoint,
                        matchingEngineLocalCustodyToken,
                        matchingEngineProgram,
                    })
                    .instruction();

                await expectIxErr(connection, [ix], [payer], "Error Code: InvalidPayloadId");
            });
        });

        async function prepareOrderResponse(args: {
            initAuction: boolean;
            executeOrder: boolean;
            prepareOrderResponse: boolean;
        }) {
            const { initAuction, executeOrder, prepareOrderResponse } = args;

            const redeemer = Keypair.generate();
            const sourceCctpDomain = 0;
            const cctpNonce = testCctpNonce++;
            const amountIn = 690000n; // 69 cents

            // Concoct a Circle message.
            const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
            const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                await craftCctpTokenBurnMessage(
                    matchingEngine,
                    sourceCctpDomain,
                    cctpNonce,
                    amountIn,
                );

            const maxFee = 42069n;
            const currTime = await connection.getBlockTime(await connection.getSlot());
            const fastMarketOrder = {
                amountIn,
                minAmountOut: 0n,
                targetChain: wormholeSdk.CHAINS.solana,
                redeemer: Array.from(redeemer.publicKey.toBuffer()),
                sender: new Array(32).fill(0),
                refundAddress: new Array(32).fill(0),
                maxFee,
                initAuctionFee: 2000n,
                deadline: currTime! + 2,
                redeemerMessage: Buffer.from("Somebody set up us the bomb"),
            };
            const fastMessage = new LiquidityLayerMessage({
                fastMarketOrder,
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
                            matchingEngine.cctpMintRecipientAddress().toBuffer(),
                        ),
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

            const prepareIx = await matchingEngine.prepareOrderResponseCctpIx(
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
            const preparedOrderResponse = matchingEngine.preparedOrderResponseAddress(fastVaaHash);
            const auction = matchingEngine.auctionAddress(fastVaaHash);

            if (initAuction) {
                const [approveIx, ix] = await matchingEngine.placeInitialOfferIx(
                    {
                        payer: offerAuthorityOne.publicKey,
                        fastVaa,
                    },
                    { offerPrice: maxFee },
                );
                await expectIxOk(connection, [approveIx, ix], [offerAuthorityOne]);

                if (executeOrder) {
                    const { info } = await matchingEngine.fetchAuction({ address: auction });
                    if (info === null) {
                        throw new Error("No auction info found");
                    }
                    const { configId, bestOfferToken, initialOfferToken, startSlot } = info;
                    const auctionConfig = matchingEngine.auctionConfigAddress(configId);
                    const { duration, gracePeriod } = await matchingEngine.fetchAuctionParameters(
                        configId,
                    );

                    await waitUntilSlot(
                        connection,
                        startSlot.toNumber() + duration + gracePeriod - 1,
                    );
                    //await new Promise((f) => setTimeout(f, startSlot.toNumber() + duration + 200));

                    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                        units: 300_000,
                    });
                    const ix = await matchingEngine.executeFastOrderCctpIx({
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
                fastMessage,
                fastMarketOrder,
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
    });
});

async function craftCctpTokenBurnMessage(
    engine: matchingEngineSdk.MatchingEngineProgram,
    sourceCctpDomain: number,
    cctpNonce: bigint,
    amount: bigint,
    overrides: { destinationCctpDomain?: number } = {},
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = engine.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
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
