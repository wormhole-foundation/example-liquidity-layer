import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { LiquidityLayerDeposit, LiquidityLayerMessage } from "../src";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";
import { VaaAccount } from "../src/wormhole";
import {
    LOCALHOST,
    MOCK_GUARDIANS,
    OWNER_ASSISTANT_KEYPAIR,
    PAYER_KEYPAIR,
    USDC_MINT_ADDRESS,
    bigintToU64BN,
    expectIxErr,
    expectIxOk,
    postLiquidityLayerVaa,
} from "./helpers";

chaiUse(chaiAsPromised);

describe("Matching Engine <> Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");

    const payer = PAYER_KEYPAIR;
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(
        connection,
        matchingEngineSdk.localnet(),
        USDC_MINT_ADDRESS
    );
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(
        connection,
        tokenRouterSdk.localnet(),
        matchingEngine.mint
    );

    describe("Redeem Fast Fill", function () {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        const orderSender = Array.from(Buffer.alloc(32, "d00d", "hex"));
        const redeemer = Keypair.generate();

        let wormholeSequence = 4000n;

        const localVariables = new Map<string, any>();

        it("Token Router ..... Cannot Redeem Fast Fill without Local Router Endpoint", async function () {
            const amount = 69n;
            const message = new LiquidityLayerMessage({
                fastFill: {
                    fill: {
                        sourceChain: foreignChain,
                        orderSender,
                        redeemer: Array.from(redeemer.publicKey.toBuffer()),
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
                "solana"
            );

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

            await expectIxErr(connection, [ix], [payer], "Error Code: AccountNotInitialized");

            // Save for later.
            localVariables.set("vaa", vaa);
            localVariables.set("amount", amount);
        });

        it("Matching Engine .. Add Local Router Endpoint using Token Router Program", async function () {
            const ix = await matchingEngine.addLocalRouterEndpointIx({
                ownerOrAssistant: ownerAssistant.publicKey,
                tokenRouterProgram: tokenRouter.ID,
            });
            await expectIxOk(connection, [ix], [ownerAssistant]);

            const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                wormholeSdk.CHAIN_ID_SOLANA
            );
            expect(routerEndpointData).to.eql(
                new matchingEngineSdk.RouterEndpoint(
                    254, // bump
                    wormholeSdk.CHAIN_ID_SOLANA,
                    Array.from(tokenRouter.custodianAddress().toBuffer()),
                    Array.from(tokenRouter.custodyTokenAccountAddress().toBuffer())
                )
            );
        });

        it("Token Router ..... Redeem Fast Fill", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            const amount = localVariables.get("amount") as bigint;

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

            const custodyToken = tokenRouter.custodyTokenAccountAddress();
            const { amount: balanceBefore } = await splToken.getAccount(connection, custodyToken);

            await expectIxOk(connection, [ix], [payer]);

            // Check balance.
            const { amount: balanceAfter } = await splToken.getAccount(connection, custodyToken);
            expect(balanceAfter).equals(balanceBefore + amount);

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
                        new BN(new BN(wormholeSequence.toString()).subn(1).toBuffer("be", 8))
                    )
                );
            }

            {
                const preparedFillData = await tokenRouter.fetchPreparedFill(preparedFill);
                const { bump } = preparedFillData;
                expect(preparedFillData).to.eql(
                    new tokenRouterSdk.PreparedFill(
                        Array.from(vaaHash),
                        bump,
                        redeemer.publicKey,
                        payer.publicKey,
                        { fastFill: {} },
                        foreignChain,
                        orderSender,
                        bigintToU64BN(amount)
                    )
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

            const rentRecipient = Keypair.generate().publicKey;
            const ix = await tokenRouter.consumePreparedFillIx({
                preparedFill,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
                rentRecipient,
            });

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);
            const solBalanceBefore = await connection.getBalance(rentRecipient);

            await expectIxOk(connection, [ix], [payer, redeemer]);

            // Check balance.
            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter).equals(balanceBefore + amount);

            const solBalanceAfter = await connection.getBalance(rentRecipient);
            const preparedFillRent = await connection.getMinimumBalanceForRentExemption(148);
            expect(solBalanceAfter).equals(solBalanceBefore + preparedFillRent);

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
                `Allocate: account Address { address: ${redeemedFastFill.toString()}, base: None } already in use`
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
                "avalanche"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

            await expectIxErr(connection, [ix], [payer], "Error Code: InvalidEmitterForFastFill");
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
                "solana"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

            await expectIxErr(connection, [ix], [payer], "Error Code: InvalidEmitterForFastFill");
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Invalid VAA", async function () {
            const vaa = await postLiquidityLayerVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                Array.from(matchingEngine.custodianAddress().toBuffer()),
                wormholeSequence++,
                Buffer.from("Oh noes!"), // message
                "solana"
            );

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

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
                    }
                ),
            });

            const vaa = await postLiquidityLayerVaa(
                connection,
                payer,
                MOCK_GUARDIANS,
                Array.from(matchingEngine.custodianAddress().toBuffer()),
                wormholeSequence++,
                message,
                "solana"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
            });

            await expectIxErr(connection, [ix], [payer], "Error Code: InvalidPayloadId");
        });
    });
});
