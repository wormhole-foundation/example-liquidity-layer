// @ts-ignore
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
} from "@solana/web3.js";
import { ChainId, encoding, toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { UniversalAddress, toUniversal } from "@wormhole-foundation/sdk-definitions";
import { deserializePostMessage } from "@wormhole-foundation/sdk-solana-core";
import { expect } from "chai";
import { CctpTokenBurnMessage } from "../src/cctp";
import { LiquidityLayerDeposit, LiquidityLayerMessage, uint64ToBN } from "../src/common";
import {
    CircleAttester,
    DEFAULT_ADDRESSES,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    OWNER_KEYPAIR,
    PAYER_KEYPAIR,
    REGISTERED_TOKEN_ROUTERS,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    expectTxsErr,
    expectTxsOk,
    getSdkSigner,
    postLiquidityLayerVaa,
    toUniversalAddress,
} from "../src/testing";
import { Custodian, PreparedOrder, TokenRouterProgram } from "../src/tokenRouter";
import { SolanaTokenRouter, SolanaTokenRouterContracts } from "../src/protocol";
import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";

const SOLANA_CHAIN_ID = toChainId("Solana");

describe("Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const { signer: payerSigner } = getSdkSigner(connection, payer);

    const relayer = Keypair.generate();
    const owner = OWNER_KEYPAIR;
    const { signer: ownerSigner } = getSdkSigner(connection, owner);
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;
    const { signer: ownerAssistantSigner } = getSdkSigner(connection, ownerAssistant);

    const foreignChain = toChainId("Ethereum");
    const invalidChain = (foreignChain + 1) as ChainId;
    const foreignEndpointAddress = REGISTERED_TOKEN_ROUTERS["Ethereum"]!;
    const foreignCctpDomain = 0;
    //const tokenRouter = new TokenRouterProgram(connection, localnet(), USDC_MINT_ADDRESS);
    const contracts: SolanaTokenRouterContracts = DEFAULT_ADDRESSES["Devnet"]!;
    const tokenRouter = new SolanaTokenRouter("Devnet", "Solana", connection, contracts);

    let lookupTableAddress: PublicKey;

    describe("Admin", function () {
        describe("Initialize", function () {
            it("Cannot Initialize without USDC Mint", async function () {
                const mint = await splToken.createMint(connection, payer, payer.publicKey, null, 6);
                const txs = tokenRouter.initialize(payer.publicKey, ownerAssistant.publicKey, mint);
                await expectTxsErr(payerSigner, txs, `mint. Error Code: ConstraintAddress`);
            });

            it("Cannot Initialize with Default Owner Assistant", async function () {
                const txs = tokenRouter.initialize(payer.publicKey, PublicKey.default);
                await expectTxsErr(payerSigner, txs, "Error Code: AssistantZeroPubkey");
            });

            it("Initialize", async function () {
                const txs = tokenRouter.initialize(payer.publicKey, ownerAssistant.publicKey);
                await expectTxsOk(payerSigner, txs);

                const custodianData = await tokenRouter.fetchCustodian();
                expect(custodianData).to.eql(
                    new Custodian(
                        false, // paused
                        payer.publicKey, // owner
                        null, // pendingOwner
                        ownerAssistant.publicKey,
                        payer.publicKey, // pausedSetBy
                    ),
                );

                const { amount } = await splToken.getAccount(
                    connection,
                    tokenRouter.cctpMintRecipientAddress(),
                );
                expect(amount).to.equal(0n);
            });

            it("Cannot Initialize Again", async function () {
                const txs = tokenRouter.initialize(payer.publicKey, ownerAssistant.publicKey);

                await expectTxsErr(
                    payerSigner,
                    txs,
                    `Allocate: account Address { address: ${tokenRouter
                        .custodianAddress()
                        .toString()}, base: None } already in use`,
                );
            });

            after("Setup Lookup Table", async function () {
                // Create.
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    }),
                );

                await expectIxOk(connection, [createIx], [payer]);

                const usdcCommonAccounts = await tokenRouter.commonAccounts();

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
                            toPubkey: relayer.publicKey,
                            lamports: 1000000000,
                        }),
                    ],
                    [payer],
                );
            });
        });

        describe("Ownership Transfer Request", async function () {
            it("Submit Ownership Transfer Request as Payer to Owner Pubkey", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: payer.publicKey,
                    newOwner: owner.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                // Confirm that the pending owner variable is set in the owner config.
                const { pendingOwner } = await tokenRouter.fetchCustodian();

                expect(pendingOwner).deep.equals(owner.publicKey);
            });

            it("Cannot Cancel Ownership Request as Non-Owner", async function () {
                const ix = await tokenRouter.cancelOwnershipTransferIx({
                    owner: ownerAssistant.publicKey,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Cancel Ownership Request as Payer", async function () {
                const ix = await tokenRouter.cancelOwnershipTransferIx({
                    owner: payer.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                // Confirm the pending owner field was reset.
                const { pendingOwner } = await tokenRouter.fetchCustodian();
                expect(pendingOwner).deep.equals(null);
            });

            it("Submit Ownership Transfer Request as Payer Again to Owner Pubkey", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: payer.publicKey,
                    newOwner: owner.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                // Confirm that the pending owner variable is set in the owner config.
                const { pendingOwner } = await tokenRouter.fetchCustodian();

                expect(pendingOwner).deep.equals(owner.publicKey);
            });

            it("Cannot Confirm Ownership Transfer Request as Non-Pending Owner", async function () {
                const ix = await tokenRouter.confirmOwnershipTransferIx({
                    pendingOwner: ownerAssistant.publicKey,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: NotPendingOwner",
                );
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                const ix = await tokenRouter.confirmOwnershipTransferIx({
                    pendingOwner: owner.publicKey,
                });

                await expectIxOk(connection, [ix], [owner]);

                // Confirm that the owner config reflects the current ownership status.
                {
                    const { owner: actualOwner, pendingOwner } = await tokenRouter.fetchCustodian();
                    expect(actualOwner).deep.equals(owner.publicKey);
                    expect(pendingOwner).deep.equals(null);
                }
            });

            it("Cannot Submit Ownership Transfer Request to Default Pubkey", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: owner.publicKey,
                    newOwner: PublicKey.default,
                });

                await expectIxErr(connection, [ix], [owner], "Error Code: InvalidNewOwner");
            });

            it("Cannot Submit Ownership Transfer Request to Himself", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: owner.publicKey,
                    newOwner: owner.publicKey,
                });

                await expectIxErr(connection, [ix], [owner], "Error Code: AlreadyOwner");
            });

            it("Cannot Submit Ownership Transfer Request as Non-Owner", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: ownerAssistant.publicKey,
                    newOwner: relayer.publicKey,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });
        });

        describe("Update Owner Assistant", async function () {
            it("Cannot Update Assistant to Default Pubkey", async function () {
                const ix = await tokenRouter.updateOwnerAssistantIx({
                    owner: owner.publicKey,
                    newOwnerAssistant: PublicKey.default,
                });

                await expectIxErr(connection, [ix], [owner], "Error Code: AssistantZeroPubkey");
            });

            it("Cannot Update Assistant as Non-Owner", async function () {
                const ix = await tokenRouter.updateOwnerAssistantIx({
                    owner: ownerAssistant.publicKey,
                    newOwnerAssistant: relayer.publicKey,
                });

                await expectIxErr(connection, [ix], [ownerAssistant], "Error Code: OwnerOnly");
            });

            it("Update Assistant as Owner", async function () {
                const ix = await tokenRouter.updateOwnerAssistantIx({
                    owner: owner.publicKey,
                    newOwnerAssistant: relayer.publicKey,
                });

                await expectIxOk(connection, [ix], [payer, owner]);

                // Confirm the assistant field was updated.
                const { ownerAssistant: actualOwnerAssistant } = await tokenRouter.fetchCustodian();
                expect(actualOwnerAssistant).to.eql(relayer.publicKey);

                // Set the assistant back to the assistant key.
                await expectIxOk(
                    connection,
                    [
                        await tokenRouter.updateOwnerAssistantIx({
                            owner: owner.publicKey,
                            newOwnerAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [owner],
                );
            });
        });

        describe("Set Pause", async function () {
            it("Cannot Set Pause for Transfers as Non-Owner", async function () {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: payer.publicKey,
                    },
                    true, // paused
                );

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Set Paused == true as Owner Assistant", async function () {
                const paused = true;
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    paused,
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const { paused: actualPaused, pausedSetBy } = await tokenRouter.fetchCustodian();
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(ownerAssistant.publicKey);
            });

            it("Set Paused == false as Owner", async function () {
                const paused = false;
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    paused,
                );

                await expectIxOk(connection, [ix], [owner]);

                const { paused: actualPaused, pausedSetBy } = await tokenRouter.fetchCustodian();
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(owner.publicKey);
            });
        });
    });

    describe("Business Logic", function () {
        let testCctpNonce = 2n ** 64n - 1n;

        // Hack to prevent math overflow error when invoking CCTP programs.
        testCctpNonce -= 20n * 6400n;

        let wormholeSequence = 2000n;

        describe("Preparing Order", function () {
            const payerToken = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                payer.publicKey,
            );

            const localVariables = new Map<string, any>();

            it("Cannot Prepare Market Order with Large Redeemer Payload", async function () {
                const txs = tokenRouter.prepareMarketOrder(payer.publicKey, {
                    amountIn: 5000n,
                    minAmountOut: 0n,
                    redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                    targetChain: toChain(foreignChain),
                    redeemerMessage: Buffer.alloc(501, "deadbeef", "hex"),
                });
                await expectTxsErr(payerSigner, txs, "Error Code: RedeemerMessageTooLarge");
            });

            it("Cannot Prepare Market Order with Insufficient Amount", async function () {
                const txs = tokenRouter.prepareMarketOrder(payer.publicKey, {
                    amountIn: 0n,
                    targetChain: toChain(foreignChain),
                    redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                    minAmountOut: 0n,
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                });
                await expectTxsErr(payerSigner, txs, "Error Code: InsufficientAmount");
            });

            it("Cannot Prepare Market Order with Invalid Redeemer", async function () {
                const txs = tokenRouter.prepareMarketOrder(payer.publicKey, {
                    amountIn: 69n,
                    targetChain: toChain(foreignChain),
                    redeemer: toUniversalAddress(Buffer.alloc(32, 0, "hex")),
                    minAmountOut: 0n,
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                });
                await expectTxsErr(payerSigner, txs, "Error Code: InvalidRedeemer");
            });

            it("Cannot Prepare Market Order with Min Amount Too High", async function () {
                const txs = tokenRouter.prepareMarketOrder(payer.publicKey, {
                    amountIn: 1n,
                    minAmountOut: 2n,
                    targetChain: toChain(foreignChain),
                    redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                });
                await expectTxsErr(payerSigner, txs, "Error Code: MinAmountOutTooHigh");
            });

            it("Cannot Prepare Market Order without Delegating Authority to Program Transfer Authority", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const minAmountOut = 0n;
                const targetChain = foreignChain;
                const redeemer = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const redeemerMessage = Buffer.from("All your base are belong to us");
                const [, ix] = await tokenRouter.prepareMarketOrderIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        senderToken: payerToken,
                    },
                    {
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer,
                        redeemerMessage,
                    },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [payer, preparedOrder],
                    "Error Code: DelegatedAmountMismatch",
                );
            });

            it("Cannot Prepare Market Order Delegating Too Much to Program Transfer Authority", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const minAmountOut = 0n;
                const targetChain = foreignChain;
                const redeemer = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const redeemerMessage = Buffer.from("All your base are belong to us");
                const [approveIx, ix] = await tokenRouter.prepareMarketOrderIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        senderToken: payerToken,
                    },
                    {
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer,
                        redeemerMessage,
                    },
                );

                // Approve for more.
                approveIx!.data.writeBigUInt64LE(amountIn + 1n, 1);

                await expectIxErr(
                    connection,
                    [approveIx!, ix],
                    [payer, preparedOrder],
                    "Error Code: DelegatedAmountMismatch",
                );
            });

            it("Cannot Prepare Market Order with Both Sender and Program Transfer Authority", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const minAmountOut = 0n;
                const targetChain = foreignChain;
                const redeemer = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const redeemerMessage = Buffer.from("All your base are belong to us");
                const [approveIx, ix] = await tokenRouter.prepareMarketOrderIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        senderToken: payerToken,
                        sender: payer.publicKey,
                    },
                    {
                        useTransferAuthority: true,
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer,
                        redeemerMessage,
                    },
                );
                expect(approveIx).is.not.null;

                await expectIxErr(
                    connection,
                    [approveIx!, ix],
                    [payer, preparedOrder],
                    "Error Code: EitherSenderOrProgramTransferAuthority",
                );
            });

            it("Cannot Prepare Market Order without Sender or Program Transfer Authority", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const minAmountOut = 0n;
                const targetChain = foreignChain;
                const redeemer = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
                const redeemerMessage = Buffer.from("All your base are belong to us");
                const [, ix] = await tokenRouter.prepareMarketOrderIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        senderToken: payerToken,
                        programTransferAuthority: null,
                        sender: null,
                    },
                    {
                        amountIn,
                        minAmountOut,
                        targetChain,
                        redeemer,
                        redeemerMessage,
                    },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [payer, preparedOrder],
                    "Error Code: EitherSenderOrProgramTransferAuthority",
                );
            });

            it("Prepare Market Order with Program Transfer Authority Specifying Some Min Amount Out", async function () {
                // TODO:: Did i remove some actual test here? for the _program transfer authority_ test?
                const preparedOrder = Keypair.generate();

                const targetChain = foreignChain;

                const request: TokenRouter.OrderRequest = {
                    amountIn: 69n,
                    targetChain: toChain(targetChain),
                    redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                    minAmountOut: 0n,
                };
                const txs = tokenRouter.prepareMarketOrder(payer.publicKey, request, preparedOrder);

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                await expectTxsOk(payerSigner, txs);

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore - request.amountIn);

                const preparedOrderData = await tokenRouter.fetchPreparedOrder(
                    preparedOrder.publicKey,
                );
                const {
                    info: { preparedCustodyTokenBump },
                } = preparedOrderData;
                expect(preparedOrderData).to.eql(
                    new PreparedOrder(
                        {
                            orderSender: payer.publicKey,
                            preparedBy: payer.publicKey,
                            orderType: {
                                market: {
                                    minAmountOut: uint64ToBN(request.minAmountOut!),
                                },
                            },
                            srcToken: payerToken,
                            refundToken: payerToken,
                            targetChain,
                            redeemer: Array.from(request.redeemer.toUint8Array()),
                            preparedCustodyTokenBump,
                        },
                        Buffer.from(request.redeemerMessage!),
                    ),
                );

                const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                    connection,
                    tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                );
                expect(preparedCustodyTokenBalance).equals(request.amountIn);
            });

            it("Prepare Market Order with Transfer Authority without Specifying Min Amount Out", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const txs = tokenRouter.prepareMarketOrder(
                    payer.publicKey,

                    {
                        amountIn,
                        targetChain: toChain(foreignChain),
                        redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                        redeemerMessage: Buffer.from("All your base are belong to us"),
                    },
                    preparedOrder,
                );

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                await expectTxsOk(payerSigner, txs);

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore - amountIn);

                const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                    connection,
                    tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                );
                expect(preparedCustodyTokenBalance).equals(amountIn);

                // We've checked other fields in a previous test. Just make sure the min amount out
                // is null.
                const { info } = await tokenRouter.fetchPreparedOrder(preparedOrder.publicKey);
                expect(info.orderType).to.eql({ market: { minAmountOut: null } });

                // Save for later.
                localVariables.set("preparedOrder", preparedOrder.publicKey);
                localVariables.set("amountIn", amountIn);
            });

            it("Cannot Close Prepared Order without Original Payer", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const ix = await tokenRouter.closePreparedOrderIx({
                    preparedOrder,
                    preparedBy: ownerAssistant.publicKey,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant, payer],
                    "prepared_by. Error Code: ConstraintAddress",
                );
            });

            it("Cannot Close Prepared Order without Order Sender", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const ix = await tokenRouter.closePreparedOrderIx({
                    preparedOrder,
                    orderSender: ownerAssistant.publicKey,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer, ownerAssistant],
                    "order_sender. Error Code: ConstraintAddress",
                );
            });

            it("Cannot Close Prepared Order without Correct Refund Token", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const refundToken = Keypair.generate().publicKey;

                const ix = await tokenRouter.closePreparedOrderIx({
                    preparedOrder,
                    refundToken,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "refund_token. Error Code: ConstraintAddress",
                );
            });

            it("Close Prepared Order", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;
                expect(localVariables.delete("preparedOrder")).is.true;
                const amountIn = localVariables.get("amountIn") as bigint;
                expect(localVariables.delete("amountIn")).is.true;

                const txs = tokenRouter.closePreparedOrder(payer.publicKey, preparedOrder);

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                await expectTxsOk(payerSigner, txs);

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore + amountIn);

                for (const key of [
                    preparedOrder,
                    tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                ]) {
                    const accInfo = await connection.getAccountInfo(key);
                    expect(accInfo).is.null;
                }
            });

            it("Prepare Market Order with Sender", async function () {
                const preparedOrder = Keypair.generate();

                const amountIn = 69n;
                const txs = tokenRouter.prepareMarketOrder(
                    payer.publicKey,
                    {
                        amountIn,
                        targetChain: toChain(foreignChain),
                        redeemer: toUniversalAddress(Buffer.alloc(32, "deadbeef", "hex")),
                        redeemerMessage: encoding.bytes.encode("All your base are belong to us"),
                    },
                    preparedOrder,
                );

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                await expectTxsOk(payerSigner, txs);

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore - amountIn);

                const { amount: preparedCustodyTokenBalance } = await splToken.getAccount(
                    connection,
                    tokenRouter.preparedCustodyTokenAddress(preparedOrder.publicKey),
                );
                expect(preparedCustodyTokenBalance).equals(amountIn);

                // We've checked other fields in a previous test. Just make sure the min amount out
                // is null.
                const { info } = await tokenRouter.fetchPreparedOrder(preparedOrder.publicKey);
                expect(info.orderType).to.eql({ market: { minAmountOut: null } });
            });
        });

        describe("Place Market Order (CCTP)", function () {
            const payerToken = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                payer.publicKey,
            );

            const redeemer = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
            const redeemerMessage = Buffer.from("All your base are belong to us");

            const localVariables = new Map<string, any>();

            it("Cannot Place Market Order without Prepared Order", async function () {
                const ix = await tokenRouter.placeMarketOrderCctpIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: Keypair.generate().publicKey,
                        preparedBy: payer.publicKey,
                    },
                    { targetChain: 23, destinationDomain: 3 },
                );

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "prepared_order. Error Code: AccountNotInitialized",
                );
            });

            it("Prepare Market Order", async function () {
                const amountIn = 69n;
                const { preparedOrder, approveIx, prepareIx } = await prepareOrder(amountIn);

                await expectIxOk(connection, [approveIx!, prepareIx], [payer, preparedOrder]);

                // Save for later.
                localVariables.set("preparedOrder", preparedOrder.publicKey);
                localVariables.set("amountIn", amountIn);
            });

            it("Cannot Place Market Order with Unregistered Endpoint", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const unregisteredEndpoint = tokenRouter
                    .matchingEngineProgram()
                    .routerEndpointAddress(SOLANA_CHAIN_ID);

                const ix = await tokenRouter.placeMarketOrderCctpIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder,
                        targetRouterEndpoint: unregisteredEndpoint,
                    },
                    { destinationDomain: 3 },
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "endpoint. Error Code: AccountNotInitialized",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );
            });

            it("Cannot Place Market Order with Invalid Target Router", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const ix = await tokenRouter.placeMarketOrderCctpIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder,
                    },
                    { targetChain: 23 },
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(connection, [ix], [payer], "Error Code: InvalidTargetRouter", {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });
            });

            it("Cannot Place Market Order without Original Preparer", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const someoneElse = Keypair.generate();
                const ix = await tokenRouter.placeMarketOrderCctpIx({
                    payer: payer.publicKey,
                    preparedOrder,
                    preparedBy: someoneElse.publicKey,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "prepared_by. Error Code: ConstraintAddress",
                );
            });

            // TODO:
            it("Place Market Order", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;
                expect(localVariables.delete("preparedOrder")).is.true;
                const amountIn = localVariables.get("amountIn") as bigint;
                expect(localVariables.delete("amountIn")).is.true;

                const txs = tokenRouter.placeMarketOrder(payer.publicKey, preparedOrder);

                await expectTxsOk(payerSigner, txs);

                checkAfterEffects({ preparedOrder, amountIn, burnSource: payerToken });

                // Save for later.
                localVariables.set("preparedOrder", preparedOrder);
            });

            it("Reclaim by Closing CCTP Message", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;
                expect(localVariables.delete("preparedOrder")).is.true;

                const cctpMessage = tokenRouter.cctpMessageAddress(preparedOrder);
                const expectedLamports = await connection
                    .getAccountInfo(cctpMessage)
                    .then((info) => info!.lamports);

                const messageTransmitter = tokenRouter.messageTransmitterProgram();
                const { message } = await messageTransmitter.fetchMessageSent(cctpMessage);

                // Simulate attestation.
                const cctpAttestation = new CircleAttester().createAttestation(message);

                // Load another keypair w/ lamports.
                const anotherPayer = Keypair.generate();
                {
                    const ix = SystemProgram.transfer({
                        fromPubkey: payer.publicKey,
                        toPubkey: anotherPayer.publicKey,
                        lamports: 1000000,
                    });
                    await expectIxOk(connection, [ix], [payer]);
                }

                const ix = await tokenRouter.reclaimCctpMessageIx(
                    {
                        payer: payer.publicKey,
                        cctpMessage,
                    },
                    cctpAttestation,
                );

                const balanceBefore = await connection.getBalance(payer.publicKey);

                await expectIxOk(connection, [ix], [anotherPayer, payer]);

                const balanceAfter = await connection.getBalance(payer.publicKey);
                expect(balanceAfter - balanceBefore).equals(expectedLamports);
            });

            it("Pause", async function () {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    true, // paused
                );

                await expectIxOk(connection, [ix], [owner]);
            });

            it("Prepare Another Market Order While Paused", async () => {
                const amountIn = 420n;
                const { preparedOrder, approveIx, prepareIx } = await prepareOrder(amountIn);

                await expectIxOk(connection, [approveIx!, prepareIx], [payer, preparedOrder]);

                // Save for later.
                localVariables.set("preparedOrder", preparedOrder.publicKey);
                localVariables.set("amountIn", amountIn);
            });

            it("Cannot Place Market Order when Paused", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;

                const ix = await tokenRouter.placeMarketOrderCctpIx({
                    payer: payer.publicKey,
                    preparedOrder,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: Paused");
            });

            it("Unpause", async function () {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    false, // paused
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);
            });

            it("Place Market Order after Unpaused", async function () {
                const preparedOrder = localVariables.get("preparedOrder") as PublicKey;
                expect(localVariables.delete("preparedOrder")).is.true;
                const amountIn = localVariables.get("amountIn") as bigint;
                expect(localVariables.delete("amountIn")).is.true;

                const ix = await tokenRouter.placeMarketOrderCctpIx({
                    payer: payer.publicKey,
                    preparedOrder,
                });

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                checkAfterEffects({ preparedOrder, amountIn, burnSource: payerToken });
            });

            it("Prepare and Place Market Order in One Transaction", async function () {
                const amountIn = 42069n;
                const { preparedOrder, approveIx, prepareIx } = await prepareOrder(amountIn);

                const ix = await tokenRouter.placeMarketOrderCctpIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        preparedBy: payer.publicKey,
                    },
                    {
                        targetChain: foreignChain,
                    },
                );

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [approveIx!, prepareIx, ix], [payer, preparedOrder], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore - amountIn);

                checkAfterEffects({
                    preparedOrder: preparedOrder.publicKey,
                    amountIn,
                    burnSource: payerToken,
                });
            });

            it("Prepare and Place Market Order in One Transaction using TokenRouter", async function () {
                const preparedOrder = Keypair.generate();

                const request: TokenRouter.OrderRequest = {
                    amountIn: 42069n,
                    targetChain: toChain(foreignChain),
                    redeemer: toUniversalAddress(redeemer),
                    redeemerMessage: redeemerMessage,
                };
                const txs = tokenRouter.placeMarketOrder(payer.publicKey, request, preparedOrder);

                const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );

                await expectTxsOk(payerSigner, txs);

                const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
                expect(balanceAfter).equals(balanceBefore - request.amountIn);

                checkAfterEffects({
                    preparedOrder: preparedOrder.publicKey,
                    amountIn: request.amountIn,
                    burnSource: payerToken,
                });
            });

            async function prepareOrder(amountIn: bigint) {
                const preparedOrder = Keypair.generate();
                const [approveIx, prepareIx] = await tokenRouter.prepareMarketOrderIx(
                    {
                        payer: payer.publicKey,
                        preparedOrder: preparedOrder.publicKey,
                        senderToken: payerToken,
                        refundToken: payerToken,
                    },
                    {
                        amountIn,
                        minAmountOut: null,
                        targetChain: foreignChain,
                        redeemer,
                        redeemerMessage,
                    },
                );

                return { preparedOrder, approveIx, prepareIx };
            }

            async function checkAfterEffects(args: {
                preparedOrder: PublicKey;
                amountIn: bigint;
                burnSource: PublicKey;
            }) {
                const { preparedOrder, amountIn, burnSource } = args;

                const message = tokenRouter.coreMessageAddress(preparedOrder);
                const { payload, emitterAddress } = await connection
                    .getAccountInfo(new PublicKey(message))
                    .then((info) => deserializePostMessage(info?.data!));

                expect(emitterAddress).to.eql(tokenRouter.custodianAddress().toBuffer());

                const { sourceCctpDomain, cctpNonce } = await (async () => {
                    const transmitter = tokenRouter.messageTransmitterProgram();
                    const config = transmitter.messageTransmitterConfigAddress();
                    const { localDomain, nextAvailableNonce } =
                        await transmitter.fetchMessageTransmitterConfig(config);
                    return {
                        sourceCctpDomain: localDomain,
                        cctpNonce: BigInt(nextAvailableNonce.subn(1).toString()),
                    };
                })();

                const {
                    protocol: { cctp: cctpProtocol },
                } = await tokenRouter.matchingEngineProgram().fetchRouterEndpointInfo(foreignChain);
                expect(cctpProtocol).is.not.null;
                const { domain: destinationCctpDomain } = cctpProtocol!;

                const depositMessage = LiquidityLayerMessage.decode(Buffer.from(payload));
                expect(depositMessage).to.eql(
                    new LiquidityLayerMessage({
                        deposit: new LiquidityLayerDeposit({
                            tokenAddress: toUniversalAddress(USDC_MINT_ADDRESS.toBuffer()),
                            amount: amountIn,
                            sourceCctpDomain,
                            destinationCctpDomain,
                            cctpNonce,
                            burnSource: toUniversalAddress(burnSource.toBuffer()),
                            mintRecipient: toUniversalAddress(foreignEndpointAddress),
                            payload: {
                                id: 1,
                                sourceChain: toChain(SOLANA_CHAIN_ID),
                                orderSender: toUniversalAddress(payer.publicKey.toBuffer()),
                                redeemer: toUniversalAddress(redeemer),
                                redeemerMessage,
                            },
                        }),
                    }),
                );

                for (const key of [
                    preparedOrder,
                    tokenRouter.preparedCustodyTokenAddress(preparedOrder),
                ]) {
                    const accInfo = await connection.getAccountInfo(key);
                    expect(accInfo).is.null;
                }
            }
        });

        describe("Redeem Fill (CCTP)", function () {
            const encodedMintRecipient = Array.from(
                tokenRouter.cctpMintRecipientAddress().toBuffer(),
            );
            const sourceCctpDomain = 0;
            const amount = 69n;
            const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
            const redeemer = Keypair.generate();

            const localVariables = new Map<string, any>();

            it("Cannot Redeem Fill from Invalid Source Router Chain", async function () {
                const cctpNonce = testCctpNonce++;

                // Concoct a Circle message.
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(
                        tokenRouter,
                        sourceCctpDomain,
                        cctpNonce,
                        encodedMintRecipient,
                        amount,
                        burnSource,
                    );

                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit({
                        tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: toUniversalAddress(burnSource),
                        mintRecipient: toUniversalAddress(encodedMintRecipient),
                        payload: {
                            id: 1,
                            sourceChain: toChain(foreignChain),
                            orderSender: toUniversalAddress(Buffer.alloc(32, "d00d", "hex")),
                            redeemer: toUniversalAddress(redeemer.publicKey.toBuffer()),
                            redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                        },
                    }),
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    foreignEndpointAddress,
                    wormholeSequence++,
                    message,
                    { sourceChain: "Polygon" },
                );
                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
                        sourceRouterEndpoint: tokenRouter
                            .matchingEngineProgram()
                            .routerEndpointAddress(foreignChain),
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
                await expectIxErr(
                    connection,
                    [computeIx, ix],
                    [payer],
                    "Error Code: InvalidSourceRouter",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );
            });

            it("Cannot Redeem Fill from Invalid Source Router Address", async function () {
                const cctpNonce = testCctpNonce++;

                // Concoct a Circle message.
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(
                        tokenRouter,
                        sourceCctpDomain,
                        cctpNonce,
                        encodedMintRecipient,
                        amount,
                        burnSource,
                    );

                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit({
                        tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: toUniversalAddress(burnSource),
                        mintRecipient: toUniversalAddress(encodedMintRecipient),
                        payload: {
                            id: 1,
                            sourceChain: toChain(foreignChain),
                            orderSender: toUniversalAddress(Buffer.alloc(32, "d00d", "hex")),
                            redeemer: toUniversalAddress(redeemer.publicKey.toBuffer()),
                            redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                        },
                    }),
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    new Array(32).fill(0), // emitter address
                    wormholeSequence++,
                    message,
                );
                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
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
                await expectIxErr(
                    connection,
                    [computeIx, ix],
                    [payer],
                    "Error Code: InvalidSourceRouter",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );
            });

            it("Cannot Redeem Fill with Invalid Deposit Message", async function () {
                const cctpNonce = testCctpNonce++;

                // Concoct a Circle message.
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(
                        tokenRouter,
                        sourceCctpDomain,
                        cctpNonce,
                        encodedMintRecipient,
                        amount,
                        burnSource,
                    );

                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit({
                        tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: toUniversalAddress(burnSource),
                        mintRecipient: toUniversalAddress(encodedMintRecipient),
                        payload: {
                            id: 2,
                            baseFee: 69n,
                        },
                    }),
                });

                // Override the payload ID in the deposit message.
                const encodedMessage = message.encode();
                encodedMessage[147] = 69;

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    foreignEndpointAddress,
                    wormholeSequence++,
                    encodedMessage,
                );
                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
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
                await expectIxErr(
                    connection,
                    [computeIx, ix],
                    [payer],
                    "Error Code: InvalidDepositMessage",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );
            });

            it("Cannot Redeem Fill with Invalid Deposit Payload ID", async function () {
                const cctpNonce = testCctpNonce++;

                // Concoct a Circle message.
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(
                        tokenRouter,
                        sourceCctpDomain,
                        cctpNonce,
                        encodedMintRecipient,
                        amount,
                        burnSource,
                    );

                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit({
                        tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: toUniversalAddress(burnSource),
                        mintRecipient: toUniversalAddress(encodedMintRecipient),
                        payload: {
                            id: 2,
                            baseFee: 69n,
                        },
                    }),
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    foreignEndpointAddress,
                    wormholeSequence++,
                    message,
                );
                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
                    },
                    {
                        encodedCctpMessage,
                        cctpAttestation,
                    },
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    "Error Code: InvalidDepositPayloadId",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );
            });

            it("Disable Router Endpoint on Matching Engine", async function () {
                const ix = await tokenRouter.matchingEngineProgram().disableRouterEndpointIx(
                    {
                        owner: owner.publicKey,
                    },
                    foreignChain,
                );

                await expectIxOk(connection, [ix], [owner]);
            });

            it("Cannot Redeem Fill without Router Endpoint", async function () {
                const cctpNonce = testCctpNonce++;

                // Concoct a Circle message.
                const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                    await craftCctpTokenBurnMessage(
                        tokenRouter,
                        sourceCctpDomain,
                        cctpNonce,
                        encodedMintRecipient,
                        amount,
                        burnSource,
                    );

                const message = new LiquidityLayerMessage({
                    deposit: new LiquidityLayerDeposit({
                        tokenAddress: toUniversalAddress(burnMessage.burnTokenAddress),
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource: toUniversalAddress(burnSource),
                        mintRecipient: toUniversalAddress(encodedMintRecipient),
                        payload: {
                            id: 1,
                            sourceChain: toChain(foreignChain),
                            orderSender: toUniversalAddress(Buffer.alloc(32, "d00d", "hex")),
                            redeemer: toUniversalAddress(redeemer.publicKey.toBuffer()),
                            redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                        },
                    }),
                });

                const vaa = await postLiquidityLayerVaa(
                    connection,
                    payer,
                    MOCK_GUARDIANS,
                    foreignEndpointAddress,
                    wormholeSequence++,
                    message,
                );
                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
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
                await expectIxErr(
                    connection,
                    [computeIx, ix],
                    [payer],
                    "Error Code: EndpointDisabled",
                    {
                        addressLookupTableAccounts: [lookupTableAccount!],
                    },
                );

                // Save for later.
                localVariables.set("args", { encodedCctpMessage, cctpAttestation });
                localVariables.set("vaa", vaa);
            });

            it("Update Router Endpoint", async function () {
                const ix = await tokenRouter.matchingEngineProgram().updateCctpRouterEndpointIx(
                    {
                        owner: owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: foreignEndpointAddress,
                        cctpDomain: foreignCctpDomain,
                        mintRecipient: null,
                    },
                );

                await expectIxOk(connection, [ix], [owner]);
            });

            it("Redeem Fill", async function () {
                const args = localVariables.get("args") as {
                    encodedCctpMessage: Buffer;
                    cctpAttestation: Buffer;
                };
                const vaa = localVariables.get("vaa") as PublicKey;

                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
                    },
                    args,
                );

                const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                    units: 400_000,
                });

                const cctpMintRecipient = tokenRouter.cctpMintRecipientAddress();
                const { amount: balanceBefore } = await splToken.getAccount(
                    connection,
                    cctpMintRecipient,
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [computeIx, ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                // Check balance.
                const { amount: balanceAfter } = await splToken.getAccount(
                    connection,
                    cctpMintRecipient,
                );
                expect(balanceAfter).equals(balanceBefore);

                // TODO: check prepared fill account.
            });

            it("Redeem Same Fill is No-op", async function () {
                const args = localVariables.get("args") as {
                    encodedCctpMessage: Buffer;
                    cctpAttestation: Buffer;
                };
                expect(localVariables.delete("args")).is.true;

                const vaa = localVariables.get("vaa") as PublicKey;

                const ix = await tokenRouter.redeemCctpFillIx(
                    {
                        payer: payer.publicKey,
                        vaa,
                    },
                    args,
                );

                const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                    lookupTableAddress,
                );
                await expectIxOk(connection, [ix], [payer], {
                    addressLookupTableAccounts: [lookupTableAccount!],
                });

                // TODO: check prepared fill account.

                // Save for later.
                localVariables.set("redeemIx", ix);
            });

            it("Consume Prepared Fill after Redeem Fill", async function () {
                const vaa = localVariables.get("vaa") as PublicKey;
                expect(localVariables.delete("vaa")).is.true;

                const someone = Keypair.generate();
                const dstToken = await splToken.createAssociatedTokenAccount(
                    connection,
                    payer,
                    USDC_MINT_ADDRESS,
                    someone.publicKey,
                );

                const beneficiary = Keypair.generate().publicKey;

                const preparedFill = tokenRouter.preparedFillAddress(vaa);
                const expectedPreparedFillLamports = await connection
                    .getAccountInfo(preparedFill)
                    .then((info) => info!.lamports);

                const custodyToken = tokenRouter.preparedCustodyTokenAddress(preparedFill);
                const { amount: custodyTokenBalance } = await splToken.getAccount(
                    connection,
                    custodyToken,
                );
                const expectedCustodyTokenLamports = await connection
                    .getAccountInfo(custodyToken)
                    .then((info) => info!.lamports);

                const ix = await tokenRouter.consumePreparedFillIx({
                    preparedFill,
                    redeemer: redeemer.publicKey,
                    dstToken,
                    beneficiary,
                });

                await expectIxOk(connection, [ix], [payer, redeemer]);

                {
                    const accInfo = await connection.getAccountInfo(preparedFill);
                    expect(accInfo).is.null;
                }
                {
                    const accInfo = await connection.getAccountInfo(custodyToken);
                    expect(accInfo).is.null;
                }

                const { amount: dstTokenBalance } = await splToken.getAccount(connection, dstToken);
                expect(dstTokenBalance).equals(custodyTokenBalance);

                const beneficiaryBalance = await connection.getBalance(beneficiary);
                expect(beneficiaryBalance).equals(
                    expectedPreparedFillLamports + expectedCustodyTokenLamports,
                );

                // Save for later.
                localVariables.set("consumeIx", ix);
            });

            it("Cannot Consume Fill Again", async function () {
                const ix = localVariables.get("consumeIx") as TransactionInstruction;
                expect(localVariables.delete("consumeIx")).is.true;

                await expectIxErr(
                    connection,
                    [ix],
                    [payer, redeemer],
                    "prepared_fill. Error Code: AccountNotInitialized",
                );
            });

            it("Cannot Redeem Fill Again (CCTP)", async function () {
                const ix = localVariables.get("redeemIx") as TransactionInstruction;
                expect(localVariables.delete("redeemIx")).is.true;

                // NOTE: This is a CCTP message transmitter error.
                await expectIxErr(connection, [ix], [payer], "Error Code: NonceAlreadyUsed");
            });
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
    overrides: { destinationCctpDomain?: number } = {},
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = tokenRouter.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
        messageTransmitterProgram.messageTransmitterConfigAddress(),
    );
    const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

    const tokenMessengerMinterProgram = tokenRouter.tokenMessengerMinterProgram();
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
            targetCaller: Array.from(tokenRouter.custodianAddress().toBuffer()), // targetCaller
        },
        0,
        Array.from(toUniversal("Ethereum", ETHEREUM_USDC_ADDRESS).toUint8Array()), // sourceTokenAddress
        encodedMintRecipient,
        amount,
        burnSource,
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
