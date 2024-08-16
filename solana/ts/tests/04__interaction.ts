import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    Signer,
    SystemProgram,
    TransactionInstruction,
    VersionedTransactionResponse,
} from "@solana/web3.js";
import {
    FastMarketOrder,
    SlowOrderResponse,
} from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, ChainId, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { expect } from "chai";
import { afterEach } from "mocha";
import { CctpTokenBurnMessage } from "../src/cctp";
import {
    LiquidityLayerDeposit,
    LiquidityLayerMessage,
    uint64ToBN,
    uint64ToBigInt,
    writeUint64BE,
} from "../src/common";
import * as matchingEngineSdk from "../src/matchingEngine";
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
    postLiquidityLayerVaa,
    toUniversalAddress,
    waitUntilSlot,
} from "../src/testing";
import * as tokenRouterSdk from "../src/tokenRouter";
import { VaaAccount } from "../src/wormhole";

const SOLANA_CHAIN_ID = toChainId("Solana");

describe("Matching Engine <> Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");

    const payer = PAYER_KEYPAIR;
    const owner = OWNER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;

    const foreignChain = toChainId("Ethereum");
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

    const playerOne = PLAYER_ONE_KEYPAIR;
    const liquidator = Keypair.generate();
    const fastFillRedeemer = Keypair.generate();

    let lookupTableAddress: PublicKey;
    const ethRouter = REGISTERED_TOKEN_ROUTERS["Ethereum"]!;

    let testCctpNonce = 2n ** 64n - 1n;

    // Hack to prevent math overflow error when invoking CCTP programs.
    testCctpNonce -= 40n * 6400n;

    let wormholeSequence = 4000n;

    describe("Admin", function () {
        describe("Matching Engine -- Local Router Endpoint", function () {
            const localVariables = new Map<string, any>();

            it("Cannot Add Local Router Endpoint without Executable", async function () {
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

            it("Cannot Add Local Router Endpoint using System Program", async function () {
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

            it("Add Local Router Endpoint using Token Router Program", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: tokenRouter.ID,
                });
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    SOLANA_CHAIN_ID,
                );
                const { bump } = routerEndpointData;
                expect(routerEndpointData).to.eql(
                    new matchingEngineSdk.RouterEndpoint(bump, {
                        chain: SOLANA_CHAIN_ID,
                        address: Array.from(tokenRouter.custodianAddress().toBuffer()),
                        mintRecipient: Array.from(
                            tokenRouter.cctpMintRecipientAddress().toBuffer(),
                        ),
                        protocol: { local: { programId: tokenRouter.ID } },
                    }),
                );

                // Save for later.
                localVariables.set("ix", ix);
            });

            it("Cannot Add Local Router Endpoint Again", async function () {
                const ix = localVariables.get("ix") as TransactionInstruction;
                expect(localVariables.delete("ix")).is.true;

                const routerEndpoint = matchingEngine.routerEndpointAddress(SOLANA_CHAIN_ID);
                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    `Allocate: account Address { address: ${routerEndpoint.toString()}, base: None } already in use`,
                );
            });

            it("Cannot Update Router Endpoint as Owner Assistant", async function () {
                await updateLocalRouterEndpointForTest(
                    { owner: ownerAssistant.publicKey },
                    {
                        signers: [ownerAssistant],
                        errorMsg: "Error Code: OwnerOnly",
                    },
                );
                // const ix = await matchingEngine.updateLocalRouterEndpointIx({
                //     owner: ownerAssistant.publicKey,
                //     tokenRouterProgram: tokenRouter.ID,
                // });

                // await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Update Router Endpoint as Owner", async function () {
                await updateLocalRouterEndpointForTest({ owner: owner.publicKey });
                // const ix = await matchingEngine.updateLocalRouterEndpointIx({
                //     owner: owner.publicKey,
                //     tokenRouterProgram: tokenRouter.ID,
                // });

                // await expectIxOk(connection, [ix], [owner]);

                // const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                //     wormholeSdk.CHAIN_ID_SOLANA,
                // );
                // const { bump } = routerEndpointData;
                // expect(routerEndpointData).to.eql(
                //     new matchingEngineSdk.RouterEndpoint(bump, {
                //         chain: wormholeSdk.CHAIN_ID_SOLANA,
                //         address: Array.from(tokenRouter.custodianAddress().toBuffer()),
                //         mintRecipient: Array.from(
                //             tokenRouter.cctpMintRecipientAddress().toBuffer(),
                //         ),
                //         protocol: { local: { programId: tokenRouter.ID } },
                //     }),
                // );
            });

            it("Cannot Disable Router Endpoint as Owner Assistant", async function () {
                await disableRouterEndpointForTest(
                    { owner: ownerAssistant.publicKey },
                    {
                        signers: [ownerAssistant],
                        errorMsg: "Error Code: OwnerOnly",
                    },
                );
                // const ix = await matchingEngine.disableRouterEndpointIx(
                //     { owner: ownerAssistant.publicKey },
                //     wormholeSdk.CHAIN_ID_SOLANA,
                // );

                // await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Disable Local Router Endpoint as Owner", async function () {
                await disableRouterEndpointForTest({ owner: owner.publicKey });
            });

            after("Re-Enable Local Router Endpoint", async function () {
                await updateLocalRouterEndpointForTest({ owner: owner.publicKey });
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

            after("Set Up Liquidiator", async function () {
                const transferIx = SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: liquidator.publicKey,
                    lamports: 1000000000,
                });

                const ata = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    liquidator.publicKey,
                );
                const createIx = splToken.createAssociatedTokenAccountInstruction(
                    payer.publicKey,
                    ata,
                    liquidator.publicKey,
                    USDC_MINT_ADDRESS,
                );
                const mintIx = splToken.createMintToInstruction(
                    USDC_MINT_ADDRESS,
                    ata,
                    payer.publicKey,
                    1_000_000_000_000n,
                );
                await expectIxOk(connection, [transferIx, createIx, mintIx], [payer]);
            });
        });
    });

    describe("Business Logic", function () {
        describe("Matching Engine -- Reserve Fast Fill Sequence", function () {
            describe("Active Auction", function () {
                it("Cannot Reserve Sequence with Non-Existent Auction", async function () {
                    await reserveFastFillSequenceActiveAuctionForTest(
                        {
                            payer: payer.publicKey,
                            auctionConfig: matchingEngine.auctionConfigAddress(0),
                            bestOfferToken: splToken.getAssociatedTokenAddressSync(
                                USDC_MINT_ADDRESS,
                                payer.publicKey,
                            ),
                        },
                        {
                            placeInitialOffer: false,
                            errorMsg: "Error Code: NoAuction",
                        },
                    );
                });

                it("Cannot Reserve Sequence with Account Not Auction", async function () {
                    await reserveFastFillSequenceActiveAuctionForTest(
                        {
                            payer: payer.publicKey,
                            auction: matchingEngine.custodianAddress(),
                            auctionConfig: matchingEngine.auctionConfigAddress(0),
                            bestOfferToken: splToken.getAssociatedTokenAddressSync(
                                USDC_MINT_ADDRESS,
                                payer.publicKey,
                            ),
                        },
                        {
                            placeInitialOffer: false,
                            errorMsg: "auction. Error Code: ConstraintSeeds",
                        },
                    );
                });

                // We need to test this by having the Auction be in Completed or Settled state.
                //
                // Because the fast fill account is not closable (yet), we do not need to perform
                // this test.
                it.skip("Cannot Reserve Sequence with Auction Not Active", async function () {
                    // TODO (?)
                });

                it.skip("Cannot Reserve Sequence with Invalid Target Router", async function () {
                    // TODO
                });

                it.skip("Cannot Reserve Sequence with Best Offer Token Mismatch", async function () {
                    // TODO
                });

                it("Cannot Reserve Sequence with Active Auction During its Duration", async function () {
                    await reserveFastFillSequenceActiveAuctionForTest(
                        {
                            payer: payer.publicKey,
                        },
                        {
                            waitUntilGracePeriod: false,
                            errorMsg: "Error Code: AuctionPeriodNotExpired",
                        },
                    );
                });

                it("Reserve Sequence with Active Auction", async function () {
                    await reserveFastFillSequenceActiveAuctionForTest({
                        payer: payer.publicKey,
                    });
                });
            });

            describe("No Auction", function () {
                it("Cannot Reserve Sequence with Non-Existent Prepared Order Response", async function () {
                    const { fast } = await observeCctpOrderVaas();

                    await reserveFastFillSequenceNoAuctionForTest(
                        {
                            payer: payer.publicKey,
                            fastVaa: fast.vaa,
                            preparedOrderResponse: Keypair.generate().publicKey,
                        },
                        {
                            errorMsg: "prepared_order_response. Error Code: AccountNotInitialized",
                        },
                    );
                });

                it("Cannot Reserve Sequence with Existing Auction", async function () {
                    await reserveFastFillSequenceNoAuctionForTest(
                        {
                            payer: payer.publicKey,
                        },
                        {
                            placeInitialOffer: true,
                            errorMsg: "Error Code: AuctionExists",
                        },
                    );
                });

                it("Cannot Reserve Sequence with VAA Mismatch", async function () {
                    const { fast } = await observeCctpOrderVaas();

                    await reserveFastFillSequenceNoAuctionForTest(
                        {
                            payer: payer.publicKey,
                            fastVaa: fast.vaa,
                        },
                        {
                            errorMsg: "Error Code: VaaMismatch",
                        },
                    );
                });

                it("Reserve Sequence with Prepared Order Response", async function () {
                    await reserveFastFillSequenceNoAuctionForTest({
                        payer: payer.publicKey,
                    });
                });
            });
        });

        describe("Settle Auction", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            describe("Settle No Auction (Local)", function () {
                before("Start Event Listener", async function () {
                    listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                        emittedEvents.push({ event, slot, signature });
                    });
                });

                after("Stop Event Listener", async function () {
                    if (listenerId !== null) {
                        matchingEngine.program.removeEventListener(listenerId!);
                    }
                });

                afterEach("Clear Emitted Events", function () {
                    while (emittedEvents.length > 0) {
                        emittedEvents.pop();
                    }
                });

                it("Settle", async function () {
                    await settleAuctionNoneLocalForTest(
                        {
                            payer: payer.publicKey,
                        },
                        emittedEvents,
                    );
                });
            });
        });

        describe("Matching Engine -- Execute Fast Order (Local)", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            before("Start Event Listener", async function () {
                listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                    emittedEvents.push({ event, slot, signature });
                });
            });

            after("Stop Event Listener", async function () {
                if (listenerId !== null) {
                    matchingEngine.program.removeEventListener(listenerId!);
                }
            });

            afterEach("Clear Emitted Events", function () {
                while (emittedEvents.length > 0) {
                    emittedEvents.pop();
                }
            });

            it.skip("Cannot Execute Fast Order (Auction Period Not Expired)", async function () {
                // TODO
            });

            it("Execute within Grace Period", async function () {
                await executeFastOrderLocalForTest(
                    {
                        payer: payer.publicKey,
                    },
                    emittedEvents,
                );
            });

            it.skip("Execute after Grace Period", async function () {
                // TODO
            });
        });

        describe("Token Router -- Redeem Fast Fill", function () {
            const emittedEvents: EmittedFilledLocalFastOrder[] = [];
            let listenerId: number | null;

            const localVariables = new Map<string, any>();

            before("Start Event Listener", async function () {
                listenerId = matchingEngine.onFilledLocalFastOrder((event, slot, signature) => {
                    emittedEvents.push({ event, slot, signature });
                });
            });

            after("Stop Event Listener", async function () {
                if (listenerId !== null) {
                    matchingEngine.program.removeEventListener(listenerId!);
                }
            });

            afterEach("Clear Emitted Events", function () {
                while (emittedEvents.length > 0) {
                    emittedEvents.pop();
                }
            });

            it("Cannot Redeem Fast Fill without Local Router Endpoint", async function () {
                await redeemFastFillForTest({ payer: payer.publicKey }, emittedEvents, {
                    disableLocalEndpoint: true,
                    errorMsg: "Error Code: EndpointDisabled",
                });

                await updateLocalRouterEndpointForTest({ owner: owner.publicKey });
            });

            it("Redeem Fast Fill", async function () {
                const redeemResult = await redeemFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                );

                // Save for later.
                localVariables.set("fastFill", redeemResult!.fastFill);
            });

            it("Redeem Same Fast Fill is No-op", async function () {
                const fastFill = localVariables.get("fastFill") as PublicKey;

                const redeemResult = await redeemFastFillForTest(
                    { payer: payer.publicKey },
                    emittedEvents,
                    {
                        fastFill,
                    },
                );

                // Save for later.
                localVariables.set("preparedFill", redeemResult!.preparedFill);
            });

            it("Consume Prepared Fill for Fast Fill", async function () {
                const preparedFill = localVariables.get("preparedFill") as PublicKey;
                expect(localVariables.delete("preparedFill")).is.true;

                const { redeemerMessage } = await tokenRouter.fetchPreparedFill(preparedFill);

                const custodyToken = tokenRouter.preparedCustodyTokenAddress(preparedFill);
                const { amount } = await splToken.getAccount(connection, custodyToken);

                const beneficiary = Keypair.generate().publicKey;
                const payerToken = splToken.getAssociatedTokenAddressSync(
                    USDC_MINT_ADDRESS,
                    payer.publicKey,
                );
                const ix = await tokenRouter.consumePreparedFillIx({
                    preparedFill,
                    redeemer: fastFillRedeemer.publicKey,
                    dstToken: payerToken,
                    beneficiary,
                });

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);
                const solBalanceBefore = await connection.getBalance(beneficiary);

                await expectIxOk(connection, [ix], [payer, fastFillRedeemer]);

                // Check balance.
                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore + amount);

                const solBalanceAfter = await connection.getBalance(beneficiary);
                const preparedFillRent = await connection.getMinimumBalanceForRentExemption(
                    153 + redeemerMessage.length,
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

            it("Cannot Redeem Same Fast Fill Again", async function () {
                const fastFill = localVariables.get("fastFill") as PublicKey;
                expect(localVariables.delete("fastFill")).is.true;

                await redeemFastFillForTest({ payer: payer.publicKey }, emittedEvents, {
                    fastFill,
                    errorMsg: "Error Code: FastFillAlreadyRedeemed",
                });
            });
        });
    });

    type PlaceInitialOfferOpts = ForTestOpts &
        ObserveCctpOrderVaasOpts & {
            args?: {
                offerPrice?: bigint;
                totalDeposit?: bigint | undefined;
            };
        };

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
        opts: PlaceInitialOfferOpts = {},
    ): Promise<void | {
        fastVaa: PublicKey;
        fastVaaAccount: VaaAccount;
        txDetails: VersionedTransactionResponse;
        auction: PublicKey;
        auctionDataBefore: matchingEngineSdk.Auction;
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
        const ixs = await matchingEngine.placeInitialOfferCctpIx(
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
        const { owner: participant, amount: offerTokenBalanceBefore } = await splToken.getAccount(
            connection,
            offerToken,
        );
        expect(offerToken).to.eql(
            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, participant),
        );

        const vaaHash = fast.vaaAccount.digest();
        const auction = matchingEngine.auctionAddress(vaaHash);
        const auctionCustodyBalanceBefore = await matchingEngine.fetchAuctionCustodyTokenBalance(
            auction,
        );

        const txDetails = await expectIxOkDetails(connection, ixs, signers);
        if (txDetails === null) {
            throw new Error("Transaction details are null");
        }
        const auctionDataBefore = await matchingEngine.fetchAuction({ address: auction });

        // Validate balance changes.
        const { amount: offerTokenBalanceAfter } = await splToken.getAccount(
            connection,
            offerToken,
        );

        const auctionCustodyBalanceAfter = await matchingEngine.fetchAuctionCustodyTokenBalance(
            auction,
        );

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fast.vaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;
        const { amountIn, maxFee, redeemerMessage } = fastMarketOrder!;

        const auctionData = await matchingEngine.fetchAuction({ address: auction });
        const { bump, info } = auctionData;
        const { custodyTokenBump, securityDeposit } = info!;

        const { auctionConfigId } = await matchingEngine.fetchCustodian();
        const notionalDeposit = await matchingEngine.computeNotionalSecurityDeposit(
            amountIn,
            auctionConfigId,
        );
        expect(uint64ToBigInt(securityDeposit)).equals(maxFee + notionalDeposit);

        const balanceChange = amountIn + uint64ToBigInt(securityDeposit);
        expect(offerTokenBalanceAfter).equals(offerTokenBalanceBefore - balanceChange);
        expect(auctionCustodyBalanceAfter).equals(auctionCustodyBalanceBefore + balanceChange);

        // Confirm the auction data.
        const expectedAmountIn = uint64ToBN(amountIn);
        expect(auctionData).to.eql(
            new matchingEngineSdk.Auction(
                bump,
                Array.from(vaaHash),
                fast.vaaAccount.timestamp(),
                { local: { programId: tokenRouter.ID } },
                { active: {} },
                accounts.payer,
                {
                    configId: auctionConfigId,
                    custodyTokenBump,
                    vaaSequence: uint64ToBN(fast.vaaAccount.emitterInfo().sequence),
                    sourceChain: fast.vaaAccount.emitterInfo().chain,
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

    type PrepareOrderResponseForTestOptionalOpts = {
        args?: matchingEngineSdk.CctpMessageArgs;
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
            baseFeeToken?: PublicKey;
        },
        opts: ForTestOpts & ObserveCctpOrderVaasOpts & PrepareOrderResponseForTestOptionalOpts = {},
    ): Promise<void | {
        fastVaa: PublicKey;
        finalizedVaa: PublicKey;
        args: matchingEngineSdk.CctpMessageArgs;
        preparedOrderResponse: PublicKey;
        prepareOrderResponseInstruction?: TransactionInstruction;
    }> {
        const [{ signers, errorMsg }, excludedForTestOpts] = setDefaultForTestOpts(opts);
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
                    const { info } = await matchingEngine.fetchAuction({ address: auction });
                    if (info === null) {
                        throw new Error("No auction info found");
                    }
                    const { configId, bestOfferToken, initialOfferToken, startSlot } = info;
                    const auctionConfig = matchingEngine.auctionConfigAddress(configId);
                    const { duration, gracePeriod, penaltyPeriod } =
                        await matchingEngine.fetchAuctionParameters(configId);

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

                    throw new Error("unsupported");
                    const ix = await matchingEngine.executeFastOrderCctpIx({
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

        const ix = await matchingEngine.prepareOrderResponseCctpIx(
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

        const preparedOrderResponse = matchingEngine.preparedOrderResponseAddress(
            fastVaaAccount.digest(),
        );
        const preparedOrderResponseBefore = await (async () => {
            if (alreadyPrepared) {
                return matchingEngine.fetchPreparedOrderResponse({
                    address: preparedOrderResponse,
                });
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

        const preparedCustodyToken =
            matchingEngine.preparedCustodyTokenAddress(preparedOrderResponse);
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

        const preparedOrderResponseData = await matchingEngine.fetchPreparedOrderResponse({
            address: preparedOrderResponse,
        });
        const { seeds } = preparedOrderResponseData;

        const finalizedVaaAccount = await VaaAccount.fetch(connection, finalizedVaa);
        const { deposit } = LiquidityLayerMessage.decode(finalizedVaaAccount.payload());
        expect(deposit).is.not.undefined;

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;

        const toEndpoint = await matchingEngine.fetchRouterEndpointInfo(
            toChainId(fastMarketOrder!.targetChain),
        );

        const baseFeeToken =
            accounts.baseFeeToken ??
            splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, payer.publicKey);

        const { baseFee } = deposit!.message.payload! as SlowOrderResponse;
        expect(preparedOrderResponseData).to.eql(
            new matchingEngineSdk.PreparedOrderResponse(
                {
                    fastVaaHash: Array.from(fastVaaAccount.digest()),
                    bump: seeds.bump,
                },
                {
                    preparedBy: accounts.payer,
                    baseFeeToken,
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
            const token = await splToken.getAccount(
                connection,
                matchingEngine.cctpMintRecipientAddress(),
            );
            expect(token.amount).equals(0n);
        }

        return {
            fastVaa,
            finalizedVaa,
            args: args!,
            preparedOrderResponse,
        };
    }

    type ReserveFastFillSequenceOpts = ForTestOpts &
        ObserveCctpOrderVaasOpts & {
            placeInitialOffer?: boolean;
            placeInitialOfferOpts?: PlaceInitialOfferOpts;
            waitUntilGracePeriod?: boolean;
        };

    async function reserveFastFillSequenceActiveAuctionForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            auction?: PublicKey;
            auctionConfig?: PublicKey;
            bestOfferToken?: PublicKey;
        },
        opts: ReserveFastFillSequenceOpts = {},
    ): Promise<void | {
        fastVaa: PublicKey;
        fastVaaAccount: VaaAccount;
        reservedSequence: PublicKey;
        auction: PublicKey;
    }> {
        const [testOpts, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let { placeInitialOffer, placeInitialOfferOpts, waitUntilGracePeriod } =
            excludedForTestOpts;
        placeInitialOffer ??= true;
        placeInitialOfferOpts ??= {};
        waitUntilGracePeriod ??= placeInitialOffer;

        const { fastVaa, fastVaaAccount } = await (async () => {
            if (placeInitialOffer) {
                const result = await placeInitialOfferCctpForTest(
                    {
                        payer: playerOne.publicKey,
                    },
                    {
                        ...placeInitialOfferOpts,
                        signers: [playerOne],
                    },
                );
                return result!;
            } else {
                const { fast } = await observeCctpOrderVaas();
                return {
                    fastVaa: fast.vaa,
                    fastVaaAccount: fast.vaaAccount,
                };
            }
        })();

        if (waitUntilGracePeriod) {
            if (!placeInitialOffer) {
                throw new Error("Cannot wait until grace period if placeInitialOffer is false");
            }

            const { info } = await matchingEngine.fetchAuction(fastVaaAccount.digest());
            const { duration, gracePeriod } = await matchingEngine.fetchAuctionParameters(
                info!.configId,
            );
            await waitUntilSlot(
                connection,
                info!.startSlot.toNumber() + duration + gracePeriod - 1,
            );
        }

        const ix = await matchingEngine.reserveFastFillSequenceActiveAuctionIx({
            ...accounts,
            fastVaa: accounts.fastVaa ?? fastVaa,
        });

        const { success, result } = await invokeReserveFastFillSequence(
            ix,
            fastVaaAccount,
            payer.publicKey,
            testOpts,
        );

        if (success) {
            return {
                fastVaa,
                fastVaaAccount,
                reservedSequence: result!.reservedSequence,
                auction: matchingEngine.auctionAddress(fastVaaAccount.digest()),
            };
        } else {
            return;
        }
    }

    async function reserveFastFillSequenceNoAuctionForTest(
        accounts: {
            payer: PublicKey;
            fastVaa?: PublicKey;
            auction?: PublicKey;
            preparedOrderResponse?: PublicKey;
        },
        opts: ReserveFastFillSequenceOpts = {},
    ): Promise<
        | undefined
        | {
              fastVaa: PublicKey;
              fastVaaAccount: VaaAccount;
              reservedSequence: PublicKey;
              finalizedVaa?: PublicKey;
              finalizedVaaAccount?: VaaAccount;
          }
    > {
        const [testOpts, excludedForTestOpts] = setDefaultForTestOpts(opts);
        let { placeInitialOffer, placeInitialOfferOpts } = excludedForTestOpts;
        placeInitialOffer ??= false;
        placeInitialOfferOpts ??= {};

        let preparedOrderResponse: PublicKey | undefined;
        const { fastVaa, fastVaaAccount, finalizedVaa, finalizedVaaAccount } = await (async () => {
            if (accounts.preparedOrderResponse === undefined) {
                const result = await prepareOrderResponseCctpForTest(
                    {
                        payer: accounts.payer,
                    },
                    { placeInitialOffer, executeOrder: false },
                );
                const { fastVaa, finalizedVaa } = result!;
                preparedOrderResponse = result!.preparedOrderResponse;

                return {
                    fastVaa,
                    fastVaaAccount: await VaaAccount.fetch(connection, fastVaa),
                    finalizedVaa: finalizedVaa,
                    finalizedVaaAccount: await VaaAccount.fetch(connection, finalizedVaa),
                };
            } else if (accounts.fastVaa !== undefined) {
                preparedOrderResponse = accounts.preparedOrderResponse;
                return {
                    fastVaa: accounts.fastVaa,
                    fastVaaAccount: await VaaAccount.fetch(connection, accounts.fastVaa),
                };
            } else {
                throw new Error("fastVaa must be defined if preparedOrderResponse is defined");
            }
        })();

        const ix = await matchingEngine.reserveFastFillSequenceNoAuctionIx({
            ...accounts,
            fastVaa: accounts.fastVaa ?? fastVaa,
            preparedOrderResponse,
        });

        const { success, result } = await invokeReserveFastFillSequence(
            ix,
            fastVaaAccount,
            accounts.payer,
            testOpts,
        );

        if (success) {
            return {
                fastVaa,
                fastVaaAccount,
                reservedSequence: result!.reservedSequence,
                finalizedVaa,
                finalizedVaaAccount,
            };
        } else {
            return;
        }
    }

    async function invokeReserveFastFillSequence(
        reserveSequenceIx: TransactionInstruction,
        fastVaaAccount: VaaAccount,
        expectedBeneficiary: PublicKey,
        testOpts: ForTestOpts = {},
    ): Promise<{ success: boolean; result: void | { reservedSequence: PublicKey } }> {
        const [{ errorMsg, signers }] = setDefaultForTestOpts(testOpts);

        if (errorMsg !== null) {
            return {
                success: false,
                result: await expectIxErr(connection, [reserveSequenceIx], signers, errorMsg),
            };
        }

        const sourceChain = fastVaaAccount.emitterInfo().chain;
        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;

        const { sender: senderAddress } = fastMarketOrder!;
        const sender = Array.from(senderAddress.toUint8Array());

        const fastFillSequencer = matchingEngine.fastFillSequencerAddress(sourceChain, sender);
        const expectedSequence = await matchingEngine
            .fetchFastFillSequencer({ address: fastFillSequencer })
            .then((data) => data.nextSequence)
            .catch((_) => uint64ToBN(0));

        await expectIxOk(connection, [reserveSequenceIx], [payer]);

        // Check fast fill sequencer account.
        const fastfillSequencerData = await matchingEngine.fetchFastFillSequencer([
            sourceChain,
            sender,
        ]);
        expect(fastfillSequencerData).to.eql(
            new matchingEngineSdk.FastFillSequencer(
                {
                    sourceChain,
                    sender,
                    bump: fastfillSequencerData.seeds.bump,
                },
                uint64ToBN(uint64ToBigInt(expectedSequence) + 1n),
            ),
        );

        // Check reserved fast fill sequence account.
        const fastVaaHash = fastVaaAccount.digest();
        const reservedSequence = matchingEngine.reservedFastFillSequenceAddress(fastVaaHash);
        const reservedSequenceData = await matchingEngine.fetchReservedFastFillSequence({
            address: reservedSequence,
        });
        expect(reservedSequenceData).to.eql(
            new matchingEngineSdk.ReservedFastFillSequence(
                {
                    fastVaaHash: Array.from(fastVaaHash),
                    bump: reservedSequenceData.seeds.bump,
                },
                expectedBeneficiary,
                {
                    sourceChain,
                    orderSender: sender,
                    sequence: expectedSequence,
                    bump: 0,
                },
            ),
        );

        return { success: true, result: { reservedSequence } };
    }

    type EmittedFilledLocalFastOrder = {
        event: matchingEngineSdk.LocalFastOrderFilled;
        slot: number;
        signature: string;
    };

    type SettleAuctionNoneOpts = ForTestOpts & ObserveCctpOrderVaasOpts;

    async function settleAuctionNoneLocalForTest(
        accounts: {
            payer: PublicKey;
            reservedSequence?: PublicKey;
        },
        emittedEvents: EmittedFilledLocalFastOrder[],
        opts: SettleAuctionNoneOpts = {},
    ): Promise<void | { event: matchingEngineSdk.LocalFastOrderFilled }> {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts);

        const reserveResult = await reserveFastFillSequenceNoAuctionForTest(
            {
                payer: accounts.payer,
            },
            excludedForTestOpts,
        );
        const { fastVaaAccount, reservedSequence, finalizedVaaAccount } = reserveResult!;
        expect(finalizedVaaAccount).is.not.undefined;

        const ix = await matchingEngine.settleAuctionNoneLocalIx({
            ...accounts,
            reservedSequence,
        });

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        const txDetails = await expectIxOkDetails(connection, [ix], signers);

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        expect(fastMarketOrder).is.not.undefined;
        const {
            amountIn,
            initAuctionFee,
            redeemer,
            sender: senderAddress,
            redeemerMessage,
        } = fastMarketOrder!;
        const sender = Array.from(senderAddress.toUint8Array());

        const message = LiquidityLayerMessage.decode(finalizedVaaAccount!.payload());
        const slowOrderResponse = message.deposit!.message.payload as SlowOrderResponse;
        expect(slowOrderResponse).is.not.undefined;
        const { baseFee } = slowOrderResponse!;

        const sourceChain = fastVaaAccount.emitterInfo().chain;
        const { nextSequence } = await matchingEngine.fetchFastFillSequencer([
            fastVaaAccount.emitterInfo().chain,
            sender,
        ]);

        // Check Fast Fill account.
        const sequence = uint64ToBigInt(nextSequence) - 1n;
        const fastFill = matchingEngine.fastFillAddress(sourceChain, sender, sequence);
        const fastFillData = await matchingEngine.fetchFastFill({ address: fastFill });
        const { seeds } = fastFillData;

        expect(fastFillData).to.eql(
            new matchingEngineSdk.FastFill(
                {
                    sourceChain,
                    orderSender: sender,
                    sequence: uint64ToBN(sequence),
                    bump: seeds.bump,
                },
                false,
                {
                    preparedBy: payer.publicKey,
                    amount: uint64ToBN(amountIn - baseFee - initAuctionFee),
                    redeemer: new PublicKey(redeemer.toUint8Array()),
                    timestamp: new BN(txDetails!.blockTime!, 10, "be"),
                },
                Buffer.from(redeemerMessage),
            ),
        );

        // Double-check that recovered seeds can be used to derive fast fill address.
        const encodedSourceChain = Buffer.alloc(2);
        encodedSourceChain.writeUInt16BE(sourceChain, 0);

        const encodedSequence = Buffer.alloc(8);
        writeUint64BE(encodedSequence, sequence);
        expect(
            PublicKey.createProgramAddressSync(
                [
                    Buffer.from("fast-fill"),
                    encodedSourceChain,
                    Buffer.from(seeds.orderSender),
                    encodedSequence,
                    Buffer.from([seeds.bump]),
                ],
                matchingEngine.ID,
            ),
        ).to.eql(fastFill);

        // Check event.
        while (emittedEvents.length == 0) {
            console.log("waiting...");
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        const { event, slot, signature } = emittedEvents.shift()!;
        expect(slot).equals(txDetails!.slot);
        expect(signature).equals(txDetails!.transaction.signatures[0]);
        expect(event).to.eql({
            seeds,
            info: fastFillData.info,
            auction: null,
        });

        return { event };
    }

    async function executeFastOrderLocalForTest(
        accounts: {
            payer: PublicKey;
        },
        emittedEvents: EmittedFilledLocalFastOrder[],
        opts: ForTestOpts & {} = {},
    ) {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts);

        const reserveResult = await reserveFastFillSequenceActiveAuctionForTest({
            payer: payer.publicKey,
        });
        const { fastVaa, fastVaaAccount, auction } = reserveResult!;

        const { address: executorToken } = await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            USDC_MINT_ADDRESS,
            liquidator.publicKey,
        );

        // const { info } = await matchingEngine.fetchAuction({ address: auction });
        // const { duration, gracePeriod } = await matchingEngine.fetchAuctionParameters();

        const localCustodyTokenBalanceBefore = await matchingEngine.fetchLocalCustodyTokenBalance(
            foreignChain,
        );

        const ix = await matchingEngine.executeFastOrderLocalIx({
            payer: payer.publicKey,
            fastVaa,
            auction,
            executorToken,
        });

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        const txDetails = await expectIxOkDetails(connection, [ix], [payer]);

        const auctionCustodyTokenBalanceAfter =
            await matchingEngine.fetchAuctionCustodyTokenBalance(auction);
        expect(auctionCustodyTokenBalanceAfter).equals(0n);
        const localCustodyTokenBalanceAfter = await matchingEngine.fetchLocalCustodyTokenBalance(
            foreignChain,
        );

        // const { penalty, userReward } = await matchingEngine.computeDepositPenalty(
        //     info!,
        //     BigInt(txDetails!.slot),
        //     info!.configId,
        // );

        const { fastMarketOrder } = LiquidityLayerMessage.decode(fastVaaAccount.payload());
        const {
            amountIn,
            maxFee: offerPrice,
            initAuctionFee,
            sender: senderAddress,
            redeemer,
            redeemerMessage,
        } = fastMarketOrder!;
        const userAmount = amountIn - offerPrice - initAuctionFee;
        expect(localCustodyTokenBalanceAfter).equals(localCustodyTokenBalanceBefore + userAmount);

        const sender = Array.from(senderAddress.toUint8Array());
        const sourceChain = fastVaaAccount.emitterInfo().chain;
        const { nextSequence } = await matchingEngine.fetchFastFillSequencer([
            fastVaaAccount.emitterInfo().chain,
            sender,
        ]);

        // Check Fast Fill account.
        const sequence = uint64ToBigInt(nextSequence) - 1n;
        const fastFill = matchingEngine.fastFillAddress(sourceChain, sender, sequence);
        const fastFillData = await matchingEngine.fetchFastFill({ address: fastFill });
        const { seeds } = fastFillData;

        expect(fastFillData).to.eql(
            new matchingEngineSdk.FastFill(
                {
                    sourceChain,
                    orderSender: sender,
                    sequence: uint64ToBN(sequence),
                    bump: seeds.bump,
                },
                false,
                {
                    preparedBy: payer.publicKey,
                    amount: uint64ToBN(userAmount),
                    redeemer: new PublicKey(redeemer.toUint8Array()),
                    timestamp: new BN(txDetails!.blockTime!, 10, "be"),
                },
                Buffer.from(redeemerMessage),
            ),
        );

        // Double-check that recovered seeds can be used to derive fast fill address.
        const encodedSourceChain = Buffer.alloc(2);
        encodedSourceChain.writeUInt16BE(sourceChain, 0);

        const encodedSequence = Buffer.alloc(8);
        writeUint64BE(encodedSequence, sequence);
        expect(
            PublicKey.createProgramAddressSync(
                [
                    Buffer.from("fast-fill"),
                    encodedSourceChain,
                    Buffer.from(seeds.orderSender),
                    encodedSequence,
                    Buffer.from([seeds.bump]),
                ],
                matchingEngine.ID,
            ),
        ).to.eql(fastFill);

        // Check event.
        while (emittedEvents.length == 0) {
            console.log("waiting...");
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        const { event, slot, signature } = emittedEvents.shift()!;
        expect(slot).equals(txDetails!.slot);
        expect(signature).equals(txDetails!.transaction.signatures[0]);
        expect(event).to.eql({
            seeds,
            info: fastFillData.info,
            auction,
        });

        return { event };
    }

    async function disableRouterEndpointForTest(
        accounts: {
            owner: PublicKey;
        },
        opts: ForTestOpts & {
            chain?: ChainId;
        } = {},
    ) {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts, {
            signers: [owner],
        });

        let { chain } = excludedForTestOpts;
        chain ??= SOLANA_CHAIN_ID;

        const ix = await matchingEngine.disableRouterEndpointIx(accounts, chain);

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        await expectIxOk(connection, [ix], signers);

        const routerEndpointData = await matchingEngine.fetchRouterEndpoint(SOLANA_CHAIN_ID);
        const { bump } = routerEndpointData;
        expect(routerEndpointData).to.eql(
            new matchingEngineSdk.RouterEndpoint(bump, {
                chain,
                address: new Array(32).fill(0),
                mintRecipient: new Array(32).fill(0),
                protocol: { none: {} },
            }),
        );
    }

    async function updateLocalRouterEndpointForTest(
        accounts: { owner: PublicKey },
        opts: ForTestOpts & {
            tokenRouterProgram?: PublicKey;
        } = {},
    ) {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts, {
            signers: [owner],
        });

        let { tokenRouterProgram } = excludedForTestOpts;
        tokenRouterProgram ??= tokenRouter.ID;

        const ix = await matchingEngine.updateLocalRouterEndpointIx({
            ...accounts,
            tokenRouterProgram,
        });

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        await expectIxOk(connection, [ix], signers);

        const routerEndpointData = await matchingEngine.fetchRouterEndpoint(SOLANA_CHAIN_ID);
        const { bump } = routerEndpointData;
        expect(routerEndpointData).to.eql(
            new matchingEngineSdk.RouterEndpoint(bump, {
                chain: SOLANA_CHAIN_ID,
                address: Array.from(tokenRouter.custodianAddress().toBuffer()),
                mintRecipient: Array.from(tokenRouter.cctpMintRecipientAddress().toBuffer()),
                protocol: { local: { programId: tokenRouter.ID } },
            }),
        );
    }

    async function redeemFastFillForTest(
        accounts: { payer: PublicKey },
        emittedEvents: EmittedFilledLocalFastOrder[],
        opts: ForTestOpts & {
            fastFill?: PublicKey;
            disableLocalEndpoint?: boolean;
        } = {},
    ) {
        const [{ errorMsg, signers }, excludedForTestOpts] = setDefaultForTestOpts(opts);

        let { disableLocalEndpoint, fastFill } = excludedForTestOpts;
        disableLocalEndpoint ??= false;

        let expectedRedeemed = true;
        if (fastFill === undefined) {
            const settleResult = await settleAuctionNoneLocalForTest(
                { payer: payer.publicKey },
                emittedEvents,
            );
            const {
                event: {
                    seeds: { sourceChain, orderSender, sequence },
                },
            } = settleResult!;

            fastFill = matchingEngine.fastFillAddress(
                sourceChain as ChainId, // Usually a no-no, but this is safe.
                orderSender,
                sequence,
            );
            expectedRedeemed = false;
        }

        const ix = await tokenRouter.redeemFastFillIx({
            ...accounts,
            fastFill,
        });

        if (disableLocalEndpoint) {
            await disableRouterEndpointForTest({ owner: owner.publicKey });
        }

        if (errorMsg !== null) {
            return expectIxErr(connection, [ix], signers, errorMsg);
        }

        const {
            seeds: fastFillSeeds,
            redeemed,
            info: fastFillInfo,
            redeemerMessage,
        } = await matchingEngine.fetchFastFill({ address: fastFill });
        expect(redeemed).equals(expectedRedeemed);

        await expectIxOk(connection, [ix], [payer]);

        // Check balance. TODO

        const preparedFill = tokenRouter.preparedFillAddress(fastFill);

        // Check fast fill account.
        const fastFillData = await matchingEngine.fetchFastFill({ address: fastFill });
        expect(fastFillData).to.eql(
            new matchingEngineSdk.FastFill(
                fastFillSeeds,
                true, // redeemed
                fastFillInfo,
                redeemerMessage,
            ),
        );

        const preparedFillData = await tokenRouter.fetchPreparedFill(preparedFill);
        const { seeds, info } = preparedFillData;
        expect(preparedFillData).to.eql(
            new tokenRouterSdk.PreparedFill(
                {
                    fillSource: fastFill,
                    bump: seeds.bump,
                },
                {
                    preparedCustodyTokenBump: info.preparedCustodyTokenBump,
                    redeemer: fastFillInfo.redeemer,
                    preparedBy: payer.publicKey,
                    fillType: { fastFill: {} },
                    sourceChain: fastFillSeeds.sourceChain,
                    orderSender: fastFillSeeds.orderSender,
                    timestamp: fastFillInfo.timestamp,
                },
                redeemerMessage,
            ),
        );

        return { fastFill, preparedFill };
    }

    type ForTestOpts = {
        signers?: Signer[];
        errorMsg?: string | null;
    };

    function setDefaultForTestOpts<T extends ForTestOpts>(
        opts: T,
        overrides: {
            signers?: Signer[];
        } = {},
    ): [{ signers: Signer[]; errorMsg: string | null }, Omit<T, keyof ForTestOpts>] {
        let { signers, errorMsg } = opts;
        signers ??= overrides.signers ?? [payer];
        delete opts.signers;

        errorMsg ??= null;
        delete opts.errorMsg;

        return [{ signers, errorMsg }, { ...opts }];
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
            targetChain: targetChain ?? "Solana",
            redeemer: toUniversalAddress(fastFillRedeemer.publicKey.toBuffer()),
            sender: toUniversalAddress(new Array(32).fill(2)),
            refundAddress: toUniversalAddress(new Array(32).fill(3)),
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

    type VaaResult = {
        vaa: PublicKey;
        vaaAccount: VaaAccount;
    };

    type FastObservedResult = VaaResult & {
        fastMarketOrder: FastMarketOrder;
    };

    type FinalizedObservedResult = VaaResult & {
        slowOrderResponse: SlowOrderResponse;
        cctp: matchingEngineSdk.CctpMessageArgs;
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
                    mintRecipient: toUniversalAddress(
                        matchingEngine.cctpMintRecipientAddress().toBuffer(),
                    ),
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

        const messageTransmitterProgram = matchingEngine.messageTransmitterProgram();
        const { version, localDomain } =
            await messageTransmitterProgram.fetchMessageTransmitterConfig(
                messageTransmitterProgram.messageTransmitterConfigAddress(),
            );
        const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

        const tokenMessengerMinterProgram = matchingEngine.tokenMessengerMinterProgram();
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
                targetCaller: Array.from(matchingEngine.custodianAddress().toBuffer()), // targetCaller
            },
            0,
            Array.from(toUniversal("Ethereum", ETHEREUM_USDC_ADDRESS).toUint8Array()), // sourceTokenAddress
            Array.from(matchingEngine.cctpMintRecipientAddress().toBuffer()), // mint recipient
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
