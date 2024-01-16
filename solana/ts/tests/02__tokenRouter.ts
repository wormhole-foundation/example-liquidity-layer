import * as wormholeSdk from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import {
    AddressLookupTableProgram,
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { CctpTokenBurnMessage, Fill, LiquidityLayerDeposit, LiquidityLayerMessage } from "../src";
import { Custodian, RouterEndpoint, TokenRouterProgram } from "../src/tokenRouter";
import {
    CircleAttester,
    ETHEREUM_USDC_ADDRESS,
    LOCALHOST,
    MOCK_GUARDIANS,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    expectIxErr,
    expectIxOk,
    postDepositVaa,
} from "./helpers";

chaiUse(chaiAsPromised);

describe("Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    const ownerAssistant = Keypair.generate();

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const invalidChain = (foreignChain + 1) as wormholeSdk.ChainId;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const foreignCctpDomain = 0;
    const unregisteredContractAddress = Buffer.alloc(32, "deafbeef", "hex");
    const tokenRouter = new TokenRouterProgram(connection);

    let lookupTableAddress: PublicKey;

    describe("Admin", function () {
        describe("Initialize", function () {
            it("Cannot Initialize Without USDC Mint", async function () {
                const mint = await splToken.createMint(connection, payer, payer.publicKey, null, 6);

                const ix = await tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    mint,
                });
                await expectIxErr(connection, [ix], [payer], "Error Code: NotUsdc");
            });

            it("Cannot Initialize With Default Owner Assistant", async function () {
                const ix = await tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: PublicKey.default,
                    mint: USDC_MINT_ADDRESS,
                });

                await expectIxErr(connection, [ix], [payer], "Error Code: AssistantZeroPubkey");
            });

            it("Initialize", async function () {
                const ix = await tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    mint: USDC_MINT_ADDRESS,
                });

                await expectIxOk(connection, [ix], [payer]);

                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                const expectedCustodianData: Custodian = {
                    bump: 253,
                    custodyTokenBump: 254,
                    paused: false,
                    owner: payer.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    pausedSetBy: payer.publicKey,
                };
                expect(custodianData).to.eql(expectedCustodianData);

                const custodyToken = await splToken.getAccount(
                    connection,
                    tokenRouter.custodyTokenAccountAddress()
                );
                expect(custodyToken.amount).to.equal(0n);
            });

            it("Cannot Initialize Again", async function () {
                const ix = await tokenRouter.initializeIx({
                    owner: payer.publicKey,
                    ownerAssistant: ownerAssistant.publicKey,
                    mint: USDC_MINT_ADDRESS,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [payer],
                    `Allocate: account Address { address: ${tokenRouter
                        .custodianAddress()
                        .toString()}, base: None } already in use`
                );
            });

            after("Setup Lookup Table", async () => {
                // Create.
                const [createIx, lookupTable] = await connection.getSlot("finalized").then((slot) =>
                    AddressLookupTableProgram.createLookupTable({
                        authority: payer.publicKey,
                        payer: payer.publicKey,
                        recentSlot: slot,
                    })
                );
                await expectIxOk(connection, [createIx], [payer]);

                const usdcCommonAccounts = tokenRouter.commonAccounts(USDC_MINT_ADDRESS);

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
                    [payer]
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
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );

                expect(custodianData.pendingOwner).deep.equals(owner.publicKey);
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
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(custodianData.pendingOwner).deep.equals(null);
            });

            it("Submit Ownership Transfer Request as Payer Again to Owner Pubkey", async function () {
                const ix = await tokenRouter.submitOwnershipTransferIx({
                    owner: payer.publicKey,
                    newOwner: owner.publicKey,
                });

                await expectIxOk(connection, [ix], [payer]);

                // Confirm that the pending owner variable is set in the owner config.
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );

                expect(custodianData.pendingOwner).deep.equals(owner.publicKey);
            });

            it("Cannot Confirm Ownership Transfer Request as Non-Pending Owner", async function () {
                const ix = await tokenRouter.confirmOwnershipTransferIx({
                    pendingOwner: ownerAssistant.publicKey,
                });

                await expectIxErr(
                    connection,
                    [ix],
                    [ownerAssistant],
                    "Error Code: NotPendingOwner"
                );
            });

            it("Confirm Ownership Transfer Request as Pending Owner", async function () {
                const ix = await tokenRouter.confirmOwnershipTransferIx({
                    pendingOwner: owner.publicKey,
                });

                await expectIxOk(connection, [ix], [owner]);

                // Confirm that the owner config reflects the current ownership status.
                {
                    const custodianData = await tokenRouter.fetchCustodian(
                        tokenRouter.custodianAddress()
                    );
                    expect(custodianData.owner).deep.equals(owner.publicKey);
                    expect(custodianData.pendingOwner).deep.equals(null);
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

                await expectIxErr(connection, [ix], [owner], "Error Code: InvalidNewAssistant");
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
                const custodianData = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(custodianData.ownerAssistant).deep.equals(relayer.publicKey);

                // Set the assistant back to the assistant key.
                await expectIxOk(
                    connection,
                    [
                        await tokenRouter.updateOwnerAssistantIx({
                            owner: owner.publicKey,
                            newOwnerAssistant: ownerAssistant.publicKey,
                        }),
                    ],
                    [owner]
                );
            });
        });

        describe("Add CCTP Router Endpoint", function () {
            it("Cannot Add CCTP Router Endpoint as Non-Owner and Non-Assistant", async function () {
                const ix = await tokenRouter.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: payer.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: routerEndpointAddress,
                        cctpDomain: foreignCctpDomain,
                    }
                );

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            [wormholeSdk.CHAINS.unset, wormholeSdk.CHAINS.solana].forEach((chain) =>
                it(`Cannot Register Chain ID == ${chain}`, async function () {
                    const ix = await tokenRouter.addCctpRouterEndpointIx(
                        {
                            ownerOrAssistant: ownerAssistant.publicKey,
                        },
                        {
                            chain,
                            address: routerEndpointAddress,
                            cctpDomain: foreignCctpDomain,
                        }
                    );

                    await expectIxErr(
                        connection,
                        [ix],
                        [ownerAssistant],
                        "Error Code: ChainNotAllowed"
                    );
                })
            );

            it("Cannot Register Zero Address", async function () {
                const ix = await tokenRouter.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: new Array(32).fill(0),
                        cctpDomain: foreignCctpDomain,
                    }
                );

                await expectIxErr(connection, [ix], [owner], "Error Code: InvalidEndpoint");
            });

            it(`Add CCTP Router Endpoint as Owner Assistant`, async function () {
                const contractAddress = Array.from(Buffer.alloc(32, "fbadc0de", "hex"));
                const ix = await tokenRouter.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: contractAddress,
                        cctpDomain: foreignCctpDomain,
                    }
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await tokenRouter.fetchRouterEndpoint(
                    tokenRouter.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData: RouterEndpoint = {
                    bump: 255,
                    chain: foreignChain,
                    address: contractAddress,
                    protocol: { cctp: { domain: foreignCctpDomain } },
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });

            it(`Update Router Endpoint as Owner`, async function () {
                const ix = await tokenRouter.addCctpRouterEndpointIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: routerEndpointAddress,
                        cctpDomain: foreignCctpDomain,
                    }
                );

                await expectIxOk(connection, [ix], [owner]);

                const routerEndpointData = await tokenRouter.fetchRouterEndpoint(
                    tokenRouter.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData: RouterEndpoint = {
                    bump: 255,
                    chain: foreignChain,
                    address: routerEndpointAddress,
                    protocol: { cctp: { domain: foreignCctpDomain } },
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });
        });

        describe("Set Pause", async function () {
            it("Cannot Set Pause for Transfers as Non-Owner", async function () {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: payer.publicKey,
                    },
                    true // paused
                );

                await expectIxErr(connection, [ix], [payer], "Error Code: OwnerOrAssistantOnly");
            });

            it("Set Paused == true as Owner Assistant", async function () {
                const paused = true;
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    paused
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);

                const { paused: actualPaused, pausedSetBy } = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
                expect(actualPaused).equals(paused);
                expect(pausedSetBy).eql(ownerAssistant.publicKey);
            });

            it("Set Paused == false as Owner", async function () {
                const paused = false;
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    paused
                );

                await expectIxOk(connection, [ix], [owner]);

                const { paused: actualPaused, pausedSetBy } = await tokenRouter.fetchCustodian(
                    tokenRouter.custodianAddress()
                );
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
        const burnSourceAuthority = Keypair.generate();

        before("Set Up Arbitrary Burn Source", async function () {
            const burnSource = await splToken.createAccount(
                connection,
                payer,
                USDC_MINT_ADDRESS,
                burnSourceAuthority.publicKey
            );

            // Add funds to account.
            await splToken.mintTo(
                connection,
                payer,
                USDC_MINT_ADDRESS,
                burnSource,
                payer,
                1_000_000_000n // 1,000 USDC
            );
        });

        it.skip("Cannot Place Market Order with Insufficient Amount", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Invalid Redeemer", async function () {
            // TODO
        });

        it.skip("Cannot Place Market Order with Unregistered Endpoint", async function () {
            // TODO
        });

        it("Cannot Place Market Order as Invalid Burn Source Authority", async function () {
            const burnSourceAuthority = Keypair.generate();

            const amountIn = 69n;
            const ix = await tokenRouter.placeMarketOrderCctpIx(
                {
                    payer: payer.publicKey,
                    mint: USDC_MINT_ADDRESS,
                    burnSource: payerToken,
                    burnSourceAuthority: burnSourceAuthority.publicKey,
                },
                {
                    amountIn,
                    targetChain: foreignChain,
                    redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                }
            );

            // TODO: use lookup table
            // NOTE: This error comes from the SPL Token program.
            await expectIxErr(
                connection,
                [ix],
                [payer, burnSourceAuthority],
                "Error: owner does not match"
            );
        });

        it("Place Market Order as Burn Source Authority", async function () {
            const burnSource = splToken.getAssociatedTokenAddressSync(
                USDC_MINT_ADDRESS,
                burnSourceAuthority.publicKey
            );
            const amountIn = 69n;
            const ix = await tokenRouter.placeMarketOrderCctpIx(
                {
                    payer: payer.publicKey,
                    mint: USDC_MINT_ADDRESS,
                    burnSource,
                    burnSourceAuthority: burnSourceAuthority.publicKey,
                },
                {
                    amountIn,
                    targetChain: foreignChain,
                    redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                }
            );

            const { amount: balanceBefore } = await splToken.getAccount(connection, burnSource);

            const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                lookupTableAddress
            );
            await expectIxOk(connection, [ix], [payer, burnSourceAuthority], {
                addressLookupTableAccounts: [lookupTableAccount!],
            });

            const { amount: balanceAfter } = await splToken.getAccount(connection, burnSource);
            expect(balanceAfter + amountIn).equals(balanceBefore);

            // TODO: check message
        });

        it("Cannot Place Market Order when Paused", async function () {
            // First pause the router.
            {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: owner.publicKey,
                    },
                    true // paused
                );

                await expectIxOk(connection, [ix], [owner]);
            }

            const ix = await tokenRouter.placeMarketOrderCctpIx(
                {
                    payer: payer.publicKey,
                    mint: USDC_MINT_ADDRESS,
                    burnSource: payerToken,
                    burnSourceAuthority: payer.publicKey,
                },
                {
                    amountIn: 69n,
                    targetChain: foreignChain,
                    redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                }
            );

            await expectIxErr(connection, [ix], [payer], "Error Code: Paused");
        });

        it("Place Market Order after Unpaused", async function () {
            // First unpause the router.
            {
                const ix = await tokenRouter.setPauseIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                    },
                    false // paused
                );

                await expectIxOk(connection, [ix], [ownerAssistant]);
            }

            const amountIn = 69n;
            const ix = await tokenRouter.placeMarketOrderCctpIx(
                {
                    payer: payer.publicKey,
                    mint: USDC_MINT_ADDRESS,
                    burnSource: payerToken,
                    burnSourceAuthority: payer.publicKey,
                },
                {
                    amountIn,
                    targetChain: foreignChain,
                    redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                    redeemerMessage: Buffer.from("All your base are belong to us"),
                }
            );

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

            const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                lookupTableAddress
            );
            await expectIxOk(connection, [ix], [payer], {
                addressLookupTableAccounts: [lookupTableAccount!],
            });

            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter + amountIn).equals(balanceBefore);

            // TODO: check message
        });
    });

    describe("Redeem Fill (CCTP)", () => {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        let testCctpNonce = 2n ** 64n - 1n;

        // Hack to prevent math overflow error when invoking CCTP programs.
        testCctpNonce -= 2n * 6400n;

        let wormholeSequence = 0n;

        const localVariables = new Map<string, any>();

        it("Redeem Fill", async function () {
            const redeemer = Keypair.generate();

            const encodedMintRecipient = Array.from(
                tokenRouter.custodyTokenAccountAddress().toBuffer()
            );
            const sourceCctpDomain = 0;
            const cctpNonce = testCctpNonce++;
            const amount = 69n;

            // Concoct a Circle message.
            const burnSource = Array.from(Buffer.alloc(32, "beefdead", "hex"));
            const { destinationCctpDomain, burnMessage, encodedCctpMessage, cctpAttestation } =
                await craftCctpTokenBurnMessage(
                    tokenRouter,
                    sourceCctpDomain,
                    cctpNonce,
                    encodedMintRecipient,
                    amount,
                    burnSource
                );

            const fill: Fill = {
                sourceChain: foreignChain,
                orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                redeemer: Array.from(redeemer.publicKey.toBuffer()),
                redeemerMessage: Buffer.from("Somebody set up us the bomb"),
            };
            const message = new LiquidityLayerMessage({
                deposit: new LiquidityLayerDeposit(
                    {
                        tokenAddress: burnMessage.burnTokenAddress,
                        amount,
                        sourceCctpDomain,
                        destinationCctpDomain,
                        cctpNonce,
                        burnSource,
                        mintRecipient: encodedMintRecipient,
                    },
                    { fill }
                ),
            });

            const vaa = await postDepositVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                routerEndpointAddress,
                wormholeSequence++,
                message
            );
            const ix = await tokenRouter.redeemCctpFillIx(
                {
                    payer: payer.publicKey,
                    vaa,
                    redeemer: redeemer.publicKey,
                    dstToken: payerToken,
                },
                {
                    encodedCctpMessage,
                    cctpAttestation,
                }
            );

            const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: 250_000,
            });

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

            const { value: lookupTableAccount } = await connection.getAddressLookupTable(
                lookupTableAddress
            );
            await expectIxOk(connection, [computeIx, ix], [payer, redeemer], {
                addressLookupTableAccounts: [lookupTableAccount!],
            });

            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter).equals(balanceBefore + amount);

            // TODO: check message
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
    overrides: { destinationCctpDomain?: number } = {}
) {
    const { destinationCctpDomain: inputDestinationCctpDomain } = overrides;

    const messageTransmitterProgram = tokenRouter.messageTransmitterProgram();
    const { version, localDomain } = await messageTransmitterProgram.fetchMessageTransmitterConfig(
        messageTransmitterProgram.messageTransmitterConfigAddress()
    );
    const destinationCctpDomain = inputDestinationCctpDomain ?? localDomain;

    const tokenMessengerMinterProgram = tokenRouter.tokenMessengerMinterProgram();
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
            targetCaller: Array.from(tokenRouter.custodianAddress().toBuffer()), // targetCaller
        },
        0,
        Array.from(wormholeSdk.tryNativeToUint8Array(ETHEREUM_USDC_ADDRESS, "ethereum")), // sourceTokenAddress
        encodedMintRecipient,
        amount,
        burnSource
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
