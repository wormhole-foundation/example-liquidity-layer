import { CHAINS, ChainId } from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Custodian, RouterEndpoint, TokenRouterProgram } from "../src";
import { LOCALHOST, PAYER_KEYPAIR, expectIxErr, expectIxOk } from "./helpers";

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
            const createInitializeIx = (opts?: { ownerAssistant?: PublicKey }) =>
                tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: opts?.ownerAssistant ?? ownerAssistant.publicKey,
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
                    paused: false,
                    owner: payer.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    pausedSetBy: payer.publicKey,
                } as Custodian;
                expect(custodianData).to.eql(expectedCustodianData);
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

    // describe.skip("Transfer Tokens with Relay", function () {
    //     const sendAmount = new BN(420_000_000); // 420.0 USDC
    //     const toNativeAmount = new BN(100_000_000); // 50.0 USDC
    //     const targetRecipientWallet = Array.from(Buffer.alloc(32, "1337beef", "hex"));

    //     const createTransferTokensWithRelayIx = (opts?: {
    //         sender?: PublicKey;
    //         fromToken?: PublicKey;
    //         amount?: BN;
    //         toNativeTokenAmount?: BN;
    //         targetRecipientWallet?: Array<number>;
    //         targetChain?: ChainId;
    //     }) =>
    //         tokenRouter.transferTokensWithRelayIx(
    //             {
    //                 payer: opts?.sender ?? payer.publicKey,
    //                 fromToken:
    //                     opts?.fromToken ??
    //                     splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, payer.publicKey),
    //             },
    //             {
    //                 amount: opts?.amount ?? sendAmount,
    //                 toNativeTokenAmount: opts?.toNativeTokenAmount ?? toNativeAmount,
    //                 targetRecipientWallet: opts?.targetRecipientWallet ?? targetRecipientWallet,
    //                 targetChain: opts?.targetChain ?? foreignChain,
    //             }
    //         );

    //     before("Set Default Parameters Before Tests", async () => {
    //         // Set default params.
    //         // await expectIxOk(
    //         //     connection,
    //         //     [
    //         //         await tokenRouter.updateRelayerFeeIx(
    //         //             {
    //         //                 ownerOrAssistant: owner.publicKey,
    //         //                 mint: USDC_MINT_ADDRESS,
    //         //             },
    //         //             {
    //         //                 chain: foreignChain,
    //         //                 relayerFee: DEFAULT_RELAYER_FEE,
    //         //             }
    //         //         ),
    //         //         await tokenRouter.updateNativeSwapRateIx(
    //         //             {
    //         //                 ownerOrAssistant: owner.publicKey,
    //         //                 mint: USDC_MINT_ADDRESS,
    //         //             },
    //         //             DEFAULT_SWAP_RATE
    //         //         ),
    //         //         await tokenRouter.updateMaxNativeSwapAmountIx(
    //         //             {
    //         //                 owner: owner.publicKey,
    //         //                 mint: USDC_MINT_ADDRESS,
    //         //             },
    //         //             DEFAULT_MAX_NATIVE_SWAP_AMOUNT
    //         //         ),
    //         //     ],
    //         //     [owner]
    //         // );
    //     });

    //     it.skip("Cannot Transfer When Paused", async function () {
    //         // TODO
    //     });

    //     it.skip("Cannot Transfer Unregistered Asset", async function () {
    //         // TODO
    //     });

    //     it.skip("Cannot Transfer Amount Less Than Sum of Relayer Fee and To Native Token Amount", async function () {
    //         // TODO
    //     });

    //     it.skip("Cannot Transfer To Unregistered Foreign Contract", async function () {
    //         // TODO
    //     });

    //     it.skip("Cannot Transfer To Zero Address", async function () {
    //         // TODO
    //     });

    //     it.skip("Cannot Transfer without Delegating Authority to Custodian", async function () {
    //         // TODO
    //     });

    //     it("Transfer Tokens With Relay", async function () {
    //         const payerToken = splToken.getAssociatedTokenAddressSync(
    //             USDC_MINT_ADDRESS,
    //             payer.publicKey
    //         );
    //         const balanceBefore = await splToken
    //             .getAccount(connection, payerToken)
    //             .then((token) => token.amount);

    //         const delegateIx = splToken.createSetAuthorityInstruction(
    //             payerToken,
    //             payer.publicKey,
    //             splToken.AuthorityType.AccountOwner,
    //             tokenRouter.custodianAddress()
    //         );

    //         await expectIxOk(
    //             connection,
    //             [delegateIx, await createTransferTokensWithRelayIx()],
    //             [payer]
    //         );

    //         // TODO: check message

    //         const balanceAfter = await splToken
    //             .getAccount(connection, payerToken)
    //             .then((token) => token.amount);
    //         expect(balanceAfter).to.eql(balanceBefore - BigInt(sendAmount.toString()));
    //     });
    // });

    // describe("Transfer Tokens With Relay Business Logic", function () {
    //   // Test parameters. The following tests rely on these parameters,
    //   // and changing them may cause the tests to fail.
    //   const batchId = 0;
    //   const sendAmount = 420000000000; // we are sending once
    //   const recipientAddress = Buffer.alloc(32, "1337beef", "hex");
    //   const initialRelayerFee = 100000000; // $1.00
    //   const maxNativeSwapAmount = 50000000000; // 50 SOL

    //   const getWormholeSequence = async () =>
    //     (
    //       await wormhole.getProgramSequenceTracker(connection, TOKEN_BRIDGE_PID, CORE_BRIDGE_PID)
    //     ).value();

    //   const verifyTmpTokenAccountDoesNotExist = async (mint: PublicKey) => {
    //     const tmpTokenAccountKey = tokenBridgeRelayer.deriveTmpTokenAccountKey(
    //       TOKEN_ROUTER_PID,
    //       mint
    //     );
    //     await expect(getAccount(connection, tmpTokenAccountKey)).to.be.rejected;
    //   };

    //   fetchTestTokens().forEach(([isNative, decimals, tokenAddress, mint, swapRate]) => {
    //     describe(getDescription(decimals, isNative, mint), function () {
    //       // Target contract swap amount.
    //       const toNativeTokenAmount = 10000000000;

    //       // ATAs.
    //       const recipientTokenAccount = getAssociatedTokenAddressSync(mint, payer.publicKey);
    //       const feeRecipientTokenAccount = getAssociatedTokenAddressSync(
    //         mint,
    //         feeRecipient.publicKey
    //       );
    //       const relayerTokenAccount = getAssociatedTokenAddressSync(mint, relayer.publicKey);

    //       describe(`Transfer Tokens With Payload`, function () {
    //         const createSendTokensWithPayloadIx = (opts?: {
    //           sender?: PublicKey;
    //           amount?: number;
    //           toNativeTokenAmount?: number;
    //           recipientAddress?: Buffer;
    //           recipientChain?: ChainId;
    //           wrapNative?: boolean;
    //         }) =>
    //           (isNative
    //             ? tokenBridgeRelayer.createTransferNativeTokensWithRelayInstruction
    //             : tokenBridgeRelayer.createTransferWrappedTokensWithRelayInstruction)(
    //             connection,
    //             TOKEN_ROUTER_PID,
    //             opts?.sender ?? payer.publicKey,
    //             TOKEN_BRIDGE_PID,
    //             CORE_BRIDGE_PID,
    //             mint,
    //             {
    //               amount: opts?.amount ?? sendAmount,
    //               toNativeTokenAmount: opts?.toNativeTokenAmount ?? toNativeTokenAmount,
    //               recipientAddress: opts?.recipientAddress ?? recipientAddress,
    //               recipientChain: opts?.recipientChain ?? foreignChain,
    //               batchId: batchId,
    //               wrapNative: opts?.wrapNative ?? mint === NATIVE_MINT ? true : false,
    //             }
    //           );

    //         it("Set the Swap Rate", async function () {
    //           // Set the swap rate.
    //           const createUpdateSwapRateIx = await tokenBridgeRelayer.createUpdateSwapRateInstruction(
    //             connection,
    //             TOKEN_ROUTER_PID,
    //             payer.publicKey,
    //             mint,
    //             new BN(swapRate)
    //           );
    //           await expectIxToSucceed(createUpdateSwapRateIx);
    //         });

    //         it("Set the Max Native Swap Amount", async function () {
    //           // Set the max native swap amount.
    //           const createUpdateMaxNativeSwapAmountIx =
    //             await tokenBridgeRelayer.updateMaxNativeSwapAmountIx(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint,
    //               mint === NATIVE_MINT ? new BN(0) : new BN(maxNativeSwapAmount)
    //             );
    //           await expectIxToSucceed(createUpdateMaxNativeSwapAmountIx);
    //         });

    //         it("Set the Initial Relayer Fee", async function () {
    //           // Set the initial relayer fee.
    //           const createUpdateRelayerFeeIx =
    //             await tokenBridgeRelayer.updateRelayerFeeIx(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               foreignChain,
    //               new BN(initialRelayerFee)
    //             );
    //           await expectIxToSucceed(createUpdateRelayerFeeIx);
    //         });

    //         it("Cannot Transfer When Paused", async function () {
    //           // Pause transfers.
    //           const createSetPauseForTransfersIx =
    //             await tokenBridgeRelayer.setPauseForTransfersIx(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               true
    //             );
    //           await expectIxToSucceed(createSetPauseForTransfersIx);

    //           // Attempt to do the transfer.
    //           await expectIxToFailWithError(
    //             await createSendTokensWithPayloadIx(),
    //             "OutboundTransfersPaused"
    //           );

    //           // Unpause transfers.
    //           const createSetPauseForTransfersIx2 =
    //             await tokenBridgeRelayer.setPauseForTransfersIx(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               false
    //             );
    //           await expectIxToSucceed(createSetPauseForTransfersIx2);
    //         });

    //         it("Cannot Transfer Unregistered Token", async function () {
    //           // Deregister the token.
    //           await expectIxToSucceed(
    //             await tokenBridgeRelayer.createDeregisterTokenInstruction(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint
    //             )
    //           );

    //           // Attempt to do the transfer.
    //           await expectIxToFailWithError(
    //             await createSendTokensWithPayloadIx(),
    //             "AccountNotInitialized"
    //           );

    //           // Register the token again.
    //           await expectIxToSucceed(
    //             await tokenBridgeRelayer.createRegisterTokenInstruction(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint,
    //               new BN(swapRate),
    //               new BN(0) // set the max native to zero, this won't affect subsequent tests
    //             )
    //           );
    //         });

    //         if (isNative && decimals > 8)
    //           it("Cannot Transfer Amount Less Than Bridgeable", async function () {
    //             await expectIxToFailWithError(
    //               await createSendTokensWithPayloadIx({ amount: 1 }),
    //               "ZeroBridgeAmount"
    //             );
    //           });

    //         if (isNative && decimals > 8)
    //           it("Cannot Set To Native Token Amount Less Than Bridgeable", async function () {
    //             await expectIxToFailWithError(
    //               await createSendTokensWithPayloadIx({
    //                 toNativeTokenAmount: 1,
    //               }),
    //               "InvalidToNativeAmount"
    //             );
    //           });

    //         it("Cannot Transfer Amount Less Than Sum of Relayer Fee and To Native Token Amount", async function () {
    //           // Calculate the relayer fee in terms of the token.
    //           const relayerFee = tokenBridgeTransform(
    //             await calculateRelayerFee(
    //               connection,
    //               program.programId,
    //               foreignChain,
    //               decimals,
    //               mint
    //             ),
    //             decimals
    //           );

    //           // Calculate the transfer amount.
    //           const insufficientAmount = relayerFee + toNativeTokenAmount - 1;

    //           await expectIxToFailWithError(
    //             await createSendTokensWithPayloadIx({
    //               amount: insufficientAmount,
    //             }),
    //             "InsufficientFunds"
    //           );
    //         });

    //         it("Cannot Transfer To Unregistered Foreign Contract", async function () {
    //           await expectIxToFailWithError(
    //             await createSendTokensWithPayloadIx({
    //               recipientChain: invalidChain,
    //             }),
    //             "AccountNotInitialized"
    //           );
    //         });

    //         [CHAINS.unset, CHAINS.solana].forEach((recipientChain) =>
    //           it(`Cannot Transfer To Chain ID == ${recipientChain}`, async function () {
    //             await expectIxToFailWithError(
    //               await createSendTokensWithPayloadIx({ recipientChain }),
    //               "AnchorError caused by account: foreign_contract. Error Code: AccountNotInitialized"
    //             );
    //           })
    //         );

    //         it("Cannot Transfer To Zero Address", async function () {
    //           await expectIxToFailWithError(
    //             await createSendTokensWithPayloadIx({
    //               recipientAddress: Buffer.alloc(32),
    //             }),
    //             "InvalidRecipient"
    //           );
    //         });

    //         if (mint !== NATIVE_MINT && isNative)
    //           it("Cannot Wrap Non-Native Token", async function () {
    //             await expectIxToFailWithError(
    //               await createSendTokensWithPayloadIx({
    //                 wrapNative: true,
    //               }),
    //               "NativeMintRequired"
    //             );
    //           });

    //         for (const toNativeAmount of [toNativeTokenAmount, 0]) {
    //           it(`Transfer with Relay (To Native Amount == ${toNativeAmount})`, async function () {
    //             const sequence = await tokenBridgeRelayer.getSignerSequenceData(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey
    //             );

    //             // Fetch the balance before the transfer.
    //             const balanceBefore = await getBalance(
    //               connection,
    //               payer.publicKey,
    //               mint === NATIVE_MINT,
    //               recipientTokenAccount
    //             );

    //             // Attempt to send the transfer.
    //             await expectIxToSucceed(
    //               createSendTokensWithPayloadIx({
    //                 toNativeTokenAmount: toNativeAmount,
    //               }),
    //               250_000
    //             );

    //             // Fetch the balance after the transfer.
    //             const balanceAfter = await getBalance(
    //               connection,
    //               payer.publicKey,
    //               mint === NATIVE_MINT,
    //               recipientTokenAccount
    //             );

    //             // Calculate the balance change and confirm it matches the expected. If
    //             // wrap is true, then the balance should decrease by the amount sent
    //             // plus the amount of lamports used to pay for the transaction.
    //             if (mint === NATIVE_MINT) {
    //               expect(balanceBefore - balanceAfter).gte(
    //                 tokenBridgeTransform(Number(sendAmount), decimals)
    //               );
    //             } else {
    //               expect(balanceBefore - balanceAfter).equals(
    //                 tokenBridgeTransform(Number(sendAmount), decimals)
    //               );
    //             }

    //             // Normalize the to native token amount.
    //             const expectedToNativeAmount = tokenBridgeNormalizeAmount(toNativeAmount, decimals);

    //             // Calculate the expected target relayer fee and normalize it.
    //             const expectedFee = tokenBridgeNormalizeAmount(
    //               await calculateRelayerFee(
    //                 connection,
    //                 program.programId,
    //                 foreignChain,
    //                 decimals,
    //                 mint
    //               ),
    //               decimals
    //             );

    //             // Normalize the transfer amount and verify that it's correct.
    //             const expectedAmount = tokenBridgeNormalizeAmount(sendAmount, decimals);

    //             // Parse the token bridge relayer payload and validate the encoded
    //             // values.
    //             await verifyRelayerMessage(
    //               connection,
    //               payer.publicKey,
    //               BigInt(sequence.toString()),
    //               expectedAmount,
    //               expectedFee,
    //               expectedToNativeAmount,
    //               recipientAddress
    //             );

    //             await verifyTmpTokenAccountDoesNotExist(mint);
    //           });
    //         }
    //       });

    //       describe("Complete Transfer with Relay", function () {
    //         // Test parameters. The following tests rely on these values
    //         // and could fail if they are changed.
    //         const feeEpsilon = 10000000;
    //         const receiveAmount = sendAmount / 6;
    //         const toNativeTokenAmount = 10000000000;
    //         expect(toNativeTokenAmount).lt(receiveAmount);

    //         // Replay protection place holder.
    //         let replayVAA: Buffer;

    //         const createRedeemTransferWithPayloadIx = (
    //           sender: PublicKey,
    //           signedMsg: Buffer,
    //           recipient: PublicKey
    //         ) =>
    //           (isNative
    //             ? tokenBridgeRelayer.createCompleteNativeTransferWithRelayInstruction
    //             : tokenBridgeRelayer.createCompleteWrappedTransferWithRelayInstruction)(
    //             connection,
    //             TOKEN_ROUTER_PID,
    //             sender,
    //             feeRecipient.publicKey,
    //             TOKEN_BRIDGE_PID,
    //             CORE_BRIDGE_PID,
    //             signedMsg,
    //             recipient
    //           );

    //         it("Cannot Redeem From Unregistered Foreign Contract", async function () {
    //           // Create the encoded transfer with relay payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             0, // relayer fee
    //             0, // to native token amount
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const bogusMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               unregisteredContractAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await postSignedMsgAsVaaOnSolana(bogusMsg);

    //           // Attempt to redeem the transfer.
    //           await expectIxToFailWithError(
    //             await createRedeemTransferWithPayloadIx(payer.publicKey, bogusMsg, payer.publicKey),
    //             "InvalidEndpoint"
    //           );
    //         });

    //         it("Cannot Redeem Unregistered Token", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Deregister the token.
    //           await expectIxToSucceed(
    //             await tokenBridgeRelayer.createDeregisterTokenInstruction(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint
    //             )
    //           );

    //           // Create the encoded transfer with relay payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, payer)).to.be.fulfilled;

    //           // Attempt to redeem the transfer.
    //           await expectIxToFailWithError(
    //             await createRedeemTransferWithPayloadIx(payer.publicKey, signedMsg, payer.publicKey),
    //             "AccountNotInitialized"
    //           );

    //           // Register the token again.
    //           await expectIxToSucceed(
    //             await tokenBridgeRelayer.createRegisterTokenInstruction(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint,
    //               new BN(swapRate),
    //               mint === NATIVE_MINT ? new BN(0) : new BN(maxNativeSwapAmount)
    //             )
    //           );
    //         });

    //         it("Cannot Redeem Invalid Recipient", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Encode a different recipient in the payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             relayer.publicKey.toBuffer().toString("hex") // encode the relayer instead of recipient
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, payer)).to.be.fulfilled;

    //           // Attempt to redeem the transfer with a different recipient.
    //           await expectIxToFailWithError(
    //             await createRedeemTransferWithPayloadIx(payer.publicKey, signedMsg, payer.publicKey),
    //             "InvalidRecipient"
    //           );
    //         });

    //         it("Self Redeem", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, payer)).to.be.fulfilled;

    //           // Fetch the balance before the transfer.
    //           const balanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(payer.publicKey, signedMsg, payer.publicKey),
    //             payer
    //           );

    //           // Fetch the balance after the transfer.
    //           const balanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );

    //           // Calculate the balance change and confirm it matches the expected. If
    //           // wrap is true, then the balance should decrease by the amount sent
    //           // plus the amount of lamports used to pay for the transaction.
    //           if (mint === NATIVE_MINT) {
    //             expect(balanceAfter - balanceBefore - receiveAmount).lte(
    //               tokenBridgeTransform(feeEpsilon, decimals)
    //             );
    //           } else {
    //             expect(balanceAfter - balanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount), decimals)
    //             );
    //           }

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("With Relayer (With Swap)", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, relayer)).to.be.fulfilled;

    //           // Fetch the token balances before the transfer.
    //           const recipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances before the transfer.
    //           const recipientLamportBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceBefore = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(relayer.publicKey, signedMsg, payer.publicKey),
    //             relayer,
    //             250_000
    //           );

    //           // Fetch the token balances after the transfer.
    //           const recipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances after the transfer.
    //           const recipientLamportBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceAfter = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Denormalize the transfer amount and relayer fee.
    //           const denormalizedReceiveAmount = tokenBridgeTransform(receiveAmount, decimals);
    //           const denormalizedRelayerFee = tokenBridgeTransform(relayerFee, decimals);

    //           // Confirm the balance changes.
    //           if (mint === NATIVE_MINT) {
    //             // Confirm lamport changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount) - denormalizedRelayerFee, decimals)
    //             );

    //             // Confirm lamport changes for the relayer.
    //             expect(relayerLamportBalanceAfter - relayerLamportBalanceBefore).gte(
    //               denormalizedRelayerFee - feeEpsilon
    //             );
    //           } else {
    //             // Calculate the expected token swap amounts.
    //             const [expectedSwapAmountIn, expectedSwapAmountOut] = await calculateSwapAmounts(
    //               connection,
    //               program.programId,
    //               decimals,
    //               mint,
    //               toNativeTokenAmount
    //             );

    //             // Confirm token changes for the recipient.
    //             expect(recipientTokenBalanceAfter - recipientTokenBalanceBefore).equals(
    //               denormalizedReceiveAmount - expectedSwapAmountIn - denormalizedRelayerFee
    //             );

    //             // Confirm token changes for fee recipient.
    //             expect(feeRecipientTokenBalanceAfter - feeRecipientTokenBalanceBefore).equals(
    //               expectedSwapAmountIn + denormalizedRelayerFee
    //             );

    //             // Confirm lamports changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               expectedSwapAmountOut
    //             );

    //             // Confirm lamports changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter)
    //               .gte(expectedSwapAmountOut)
    //               .lte(expectedSwapAmountOut + feeEpsilon);
    //           }

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("With Relayer (With Max Swap Limit Reached)", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Update the max native swap amount if the toNativeTokenAmount is
    //           // not enough to cap the swap quantity.
    //           {
    //             // Compute the max native swap amount in token terms.
    //             const [maxNativeSwapAmountInTokens, _, __] = await getSwapInputs(
    //               connection,
    //               program.programId,
    //               decimals,
    //               mint
    //             );

    //             if (toNativeTokenAmount <= maxNativeSwapAmountInTokens) {
    //               // Reduce the max native swap amount to half of the
    //               // to native token amount equivalent.
    //               const newMaxNativeSwapAmount =
    //                 maxNativeSwapAmount * (toNativeTokenAmount / maxNativeSwapAmountInTokens / 2);

    //               await expectIxToSucceed(
    //                 await tokenBridgeRelayer.updateMaxNativeSwapAmountIx(
    //                   connection,
    //                   TOKEN_ROUTER_PID,
    //                   payer.publicKey,
    //                   mint,
    //                   new BN(newMaxNativeSwapAmount)
    //                 )
    //               );
    //             }
    //           }

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, relayer)).to.be.fulfilled;

    //           // Fetch the token balances before the transfer.
    //           const recipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances before the transfer.
    //           const recipientLamportBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceBefore = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(relayer.publicKey, signedMsg, payer.publicKey),
    //             relayer,
    //             250_000
    //           );

    //           // Fetch the token balances after the transfer.
    //           const recipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances after the transfer.
    //           const recipientLamportBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceAfter = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Denormalize the transfer amount and relayer fee.
    //           const denormalizedReceiveAmount = tokenBridgeTransform(receiveAmount, decimals);
    //           const denormalizedRelayerFee = tokenBridgeTransform(relayerFee, decimals);

    //           // Confirm the balance changes.
    //           if (mint === NATIVE_MINT) {
    //             // Confirm lamport changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount) - denormalizedRelayerFee, decimals)
    //             );

    //             // Confirm lamport changes for the relayer.
    //             expect(relayerLamportBalanceAfter - relayerLamportBalanceBefore).gte(
    //               denormalizedRelayerFee - feeEpsilon
    //             );
    //           } else {
    //             // Calculate the expected token swap amounts.
    //             const [expectedSwapAmountIn, expectedSwapAmountOut] = await calculateSwapAmounts(
    //               connection,
    //               program.programId,
    //               decimals,
    //               mint,
    //               toNativeTokenAmount
    //             );

    //             // Confirm that the expectedSwapAmountIn is less than the
    //             // original to native token amount.
    //             expect(expectedSwapAmountIn).lt(toNativeTokenAmount);

    //             // Confirm token changes for the recipient.
    //             expect(recipientTokenBalanceAfter - recipientTokenBalanceBefore).equals(
    //               denormalizedReceiveAmount - expectedSwapAmountIn - denormalizedRelayerFee
    //             );

    //             // Confirm token changes for fee recipient.
    //             expect(feeRecipientTokenBalanceAfter - feeRecipientTokenBalanceBefore).equals(
    //               expectedSwapAmountIn + denormalizedRelayerFee
    //             );

    //             // Confirm lamports changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               expectedSwapAmountOut
    //             );

    //             // Confirm lamports changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter)
    //               .gte(expectedSwapAmountOut)
    //               .lte(expectedSwapAmountOut + feeEpsilon);
    //           }

    //           // Set the max native swap amount back to the initial value.
    //           await expectIxToSucceed(
    //             await tokenBridgeRelayer.updateMaxNativeSwapAmountIx(
    //               connection,
    //               TOKEN_ROUTER_PID,
    //               payer.publicKey,
    //               mint,
    //               mint === NATIVE_MINT ? new BN(0) : new BN(maxNativeSwapAmount)
    //             )
    //           );

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("With Relayer (With Swap No Fee)", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload. Set the
    //           // target relayer fee to zero for this test.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(0, decimals),
    //             tokenBridgeNormalizeAmount(toNativeTokenAmount, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, relayer)).to.be.fulfilled;

    //           // Fetch the token balances before the transfer.
    //           const recipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances before the transfer.
    //           const recipientLamportBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceBefore = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(relayer.publicKey, signedMsg, payer.publicKey),
    //             relayer,
    //             250_000
    //           );

    //           // Fetch the token balances after the transfer.
    //           const recipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances after the transfer.
    //           const recipientLamportBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceAfter = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Denormalize the transfer amount and relayer fee.
    //           const denormalizedReceiveAmount = tokenBridgeTransform(receiveAmount, decimals);
    //           const denormalizedRelayerFee = tokenBridgeTransform(relayerFee, decimals);

    //           // Confirm the balance changes.
    //           if (mint === NATIVE_MINT) {
    //             // Confirm lamport changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount), decimals)
    //             );

    //             // Confirm lamport changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter).lte(feeEpsilon);
    //           } else {
    //             // Calculate the expected token swap amounts.
    //             const [expectedSwapAmountIn, expectedSwapAmountOut] = await calculateSwapAmounts(
    //               connection,
    //               program.programId,
    //               decimals,
    //               mint,
    //               toNativeTokenAmount
    //             );

    //             // Confirm token changes for the recipient.
    //             expect(recipientTokenBalanceAfter - recipientTokenBalanceBefore).equals(
    //               denormalizedReceiveAmount - expectedSwapAmountIn
    //             );

    //             // Confirm token changes for fee recipient.
    //             expect(feeRecipientTokenBalanceAfter - feeRecipientTokenBalanceBefore).equals(
    //               expectedSwapAmountIn
    //             );

    //             // Confirm lamports changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               expectedSwapAmountOut
    //             );

    //             // Confirm lamports changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter)
    //               .gte(expectedSwapAmountOut)
    //               .lte(expectedSwapAmountOut + feeEpsilon);
    //           }

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("With Relayer (No Fee and No Swap)", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload. Set the
    //           // to native token amount and relayer fee to zero for this test.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(0, decimals),
    //             tokenBridgeNormalizeAmount(0, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, relayer)).to.be.fulfilled;

    //           // Fetch the token balances before the transfer.
    //           const recipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances before the transfer.
    //           const recipientLamportBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceBefore = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(relayer.publicKey, signedMsg, payer.publicKey),
    //             relayer
    //           );

    //           // Fetch the token balances after the transfer.
    //           const recipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances after the transfer.
    //           const recipientLamportBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceAfter = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Denormalize the transfer amount and relayer fee.
    //           const denormalizedReceiveAmount = tokenBridgeTransform(receiveAmount, decimals);

    //           // Confirm the balance changes.
    //           if (mint === NATIVE_MINT) {
    //             // Confirm lamport changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount), decimals)
    //             );

    //             // Confirm lamport changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter).lte(feeEpsilon);
    //           } else {
    //             // Confirm token changes for the recipient.
    //             expect(recipientTokenBalanceAfter - recipientTokenBalanceBefore).equals(
    //               denormalizedReceiveAmount
    //             );

    //             // Confirm token changes for fee recipient.
    //             expect(feeRecipientTokenBalanceAfter - feeRecipientTokenBalanceBefore).equals(0);

    //             // Confirm lamports changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(0);

    //             // Confirm lamports changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter).lte(feeEpsilon);
    //           }

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("With Relayer (No Swap With Fee)", async function () {
    //           // Define inbound transfer parameters. Calculate the fee
    //           // using the foreignChain to simulate calculating the
    //           // target relayer fee. This contract won't allow us to set
    //           // a relayer fee for the Solana chain ID.
    //           const relayerFee = await calculateRelayerFee(
    //             connection,
    //             program.programId,
    //             foreignChain, // placeholder
    //             decimals,
    //             mint
    //           );

    //           // Create the encoded transfer with relay payload. Set the
    //           // to native token amount to zero for this test.
    //           const transferWithRelayPayload = createTransferWithRelayPayload(
    //             tokenBridgeNormalizeAmount(relayerFee, decimals),
    //             tokenBridgeNormalizeAmount(0, decimals),
    //             payer.publicKey.toBuffer().toString("hex")
    //           );

    //           // Create the token bridge message.
    //           const signedMsg = guardianSign(
    //             foreignTokenBridge.publishTransferTokensWithPayload(
    //               tokenAddress,
    //               isNative ? CHAINS.solana : foreignChain, // tokenChain
    //               BigInt(tokenBridgeNormalizeAmount(receiveAmount, decimals)),
    //               CHAINS.solana, // recipientChain
    //               TOKEN_ROUTER_PID.toBuffer().toString("hex"),
    //               routerEndpointAddress,
    //               Buffer.from(transferWithRelayPayload.substring(2), "hex"),
    //               batchId
    //             )
    //           );
    //           replayVAA = signedMsg;

    //           // Post the Wormhole message.
    //           await expect(postSignedMsgAsVaaOnSolana(signedMsg, relayer)).to.be.fulfilled;

    //           // Fetch the token balances before the transfer.
    //           const recipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceBefore = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances before the transfer.
    //           const recipientLamportBalanceBefore = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceBefore = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Complete the transfer.
    //           await expectIxToSucceed(
    //             createRedeemTransferWithPayloadIx(relayer.publicKey, signedMsg, payer.publicKey),
    //             relayer
    //           );

    //           // Fetch the token balances after the transfer.
    //           const recipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             mint === NATIVE_MINT,
    //             recipientTokenAccount
    //           );
    //           const feeRecipientTokenBalanceAfter = await getBalance(
    //             connection,
    //             feeRecipient.publicKey,
    //             mint === NATIVE_MINT,
    //             feeRecipientTokenAccount
    //           );

    //           // Fetch the lamport balances after the transfer.
    //           const recipientLamportBalanceAfter = await getBalance(
    //             connection,
    //             payer.publicKey,
    //             true,
    //             recipientTokenAccount
    //           );
    //           const relayerLamportBalanceAfter = await getBalance(
    //             connection,
    //             relayer.publicKey,
    //             true,
    //             relayerTokenAccount
    //           );

    //           // Denormalize the transfer amount and relayer fee.
    //           const denormalizedReceiveAmount = tokenBridgeTransform(receiveAmount, decimals);
    //           const denormalizedRelayerFee = tokenBridgeTransform(relayerFee, decimals);

    //           // Confirm the balance changes.
    //           if (mint === NATIVE_MINT) {
    //             // Confirm lamport changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(
    //               tokenBridgeTransform(Number(receiveAmount) - denormalizedRelayerFee, decimals)
    //             );

    //             // Confirm lamport changes for the relayer.
    //             expect(relayerLamportBalanceAfter - relayerLamportBalanceBefore).gte(
    //               denormalizedRelayerFee - feeEpsilon
    //             );
    //           } else {
    //             // Confirm token changes for the recipient.
    //             expect(recipientTokenBalanceAfter - recipientTokenBalanceBefore).equals(
    //               denormalizedReceiveAmount - denormalizedRelayerFee
    //             );

    //             // Confirm token changes for fee recipient.
    //             expect(feeRecipientTokenBalanceAfter - feeRecipientTokenBalanceBefore).equals(
    //               denormalizedRelayerFee
    //             );

    //             // Confirm lamports changes for the recipient.
    //             expect(recipientLamportBalanceAfter - recipientLamportBalanceBefore).equals(0);

    //             // Confirm lamports changes for the relayer.
    //             expect(relayerLamportBalanceBefore - relayerLamportBalanceAfter).lte(feeEpsilon);
    //           }

    //           await verifyTmpTokenAccountDoesNotExist(mint);
    //         });

    //         it("Cannot Redeem Again", async function () {
    //           await expectIxToFailWithError(
    //             await createRedeemTransferWithPayloadIx(
    //               relayer.publicKey,
    //               replayVAA,
    //               payer.publicKey
    //             ),
    //             "AlreadyRedeemed",
    //             relayer
    //           );
    //         });
    //       });
    //     });
    //   });
    // });
});
