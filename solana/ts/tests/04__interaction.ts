import * as wormholeSdk from "@certusone/wormhole-sdk";
import { BN } from "@coral-xyz/anchor";
import * as splToken from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
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
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(connection);
    const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(connection);

    describe("Redeem Fast Fill", function () {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        let wormholeSequence = 4000n;

        const localVariables = new Map<string, any>();

        it("Token Router ..... Cannot Redeem Fast Fill as Unregistered Token Router", async function () {
            const redeemer = Keypair.generate();

            const amount = 69n;
            const message = new LiquidityLayerMessage({
                fastFill: {
                    fill: {
                        sourceChain: foreignChain,
                        orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
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
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(connection, [ix], [payer, redeemer], "Error Code: ConstraintAddress");

            // Save for later.
            localVariables.set("vaa", vaa);
            localVariables.set("redeemer", redeemer);
            localVariables.set("amount", amount);
        });

        it("Matching Engine .. Remove Local Router Endpoint", async function () {
            const ix = await matchingEngine.removeRouterEndpointIx(
                {
                    ownerOrAssistant: ownerAssistant.publicKey,
                },
                wormholeSdk.CHAIN_ID_SOLANA
            );
            await expectIxOk(connection, [ix], [ownerAssistant]);

            const accInfo = await connection.getAccountInfo(
                matchingEngine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
            );
            expect(accInfo).is.null;
        });

        it("Token Router ..... Cannot Redeem Fast Fill without Local Router Endpoint", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            const redeemer = localVariables.get("redeemer") as Keypair;

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(
                connection,
                [ix],
                [payer, redeemer],
                "Error Code: AccountNotInitialized"
            );
        });

        it("Matching Engine .. Add Local Router Endpoint using Token Router Program", async function () {
            const ix = await matchingEngine.addLocalRouterEndpointIx({
                ownerOrAssistant: ownerAssistant.publicKey,
                tokenRouterProgram: tokenRouter.ID,
            });
            await expectIxOk(connection, [ix], [ownerAssistant]);

            const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                matchingEngine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
            );
            const expectedRouterEndpointData = new matchingEngineSdk.RouterEndpoint(
                254, // bump
                wormholeSdk.CHAIN_ID_SOLANA,
                Array.from(tokenRouter.custodianAddress().toBuffer())
            );
            expect(routerEndpointData).to.eql(expectedRouterEndpointData);
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Invalid Redeemer", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;

            const redeemer = Keypair.generate();
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(connection, [ix], [payer, redeemer], "Error Code: InvalidRedeemer");
        });

        it("Token Router ..... Redeem Fast Fill", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            const redeemer = localVariables.get("redeemer") as Keypair;

            const amount = localVariables.get("amount") as bigint;
            expect(localVariables.delete("amount")).is.true;

            const { amount: balanceBefore } = await splToken.getAccount(connection, payerToken);

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxOk(connection, [ix], [payer, redeemer]);

            // Check balance.
            const { amount: balanceAfter } = await splToken.getAccount(connection, payerToken);
            expect(balanceAfter).equals(balanceBefore + amount);

            // Check redeemed fast fill account.
            const vaaHash = await VaaAccount.fetch(connection, vaa).then((vaa) => vaa.digest());
            //console.log("vaaHash...", Buffer.from(vaaHash).toString("hex"));
            const redeemedFastFill = matchingEngine.redeemedFastFillAddress(vaaHash);
            const redeemedFastFillData = await matchingEngine.fetchRedeemedFastFill(
                redeemedFastFill
            );

            // The VAA hash can change depending on the message (sequence is usually the reason for
            // this). So we just take the bump from the fetched data and move on with our lives.
            const { bump } = redeemedFastFillData;
            expect(redeemedFastFillData).to.eql(
                new matchingEngineSdk.RedeemedFastFill(
                    bump,
                    Array.from(vaaHash),
                    new BN(new BN(wormholeSequence.toString()).subn(1).toBuffer("be", 8))
                )
            );

            // Save for later.
            localVariables.set("redeemedFastFill", redeemedFastFill);
        });

        it("Token Router ..... Cannot Redeem Same Fast Fill Again", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            expect(localVariables.delete("vaa")).is.true;

            const redeemer = localVariables.get("redeemer") as Keypair;
            expect(localVariables.delete("redeemer")).is.true;

            const redeemedFastFill = localVariables.get("redeemedFastFill") as PublicKey;
            expect(localVariables.delete("redeemedFastFill")).is.true;

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(
                connection,
                [ix],
                [payer, redeemer],
                `Allocate: account Address { address: ${redeemedFastFill.toString()}, base: None } already in use`
            );
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Invalid VAA Account (Not Owned by Core Bridge)", async function () {
            const redeemer = Keypair.generate();

            const amount = 69n;
            const message = new LiquidityLayerMessage({
                fastFill: {
                    fill: {
                        sourceChain: foreignChain,
                        orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
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
                "avalanche"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            // Replace the VAA account pubkey with garbage.
            ix.keys[ix.keys.findIndex((key) => key.pubkey.equals(vaa))].pubkey = SYSVAR_RENT_PUBKEY;

            await expectIxErr(connection, [ix], [payer, redeemer], "Error Code: ConstraintOwner");
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Emitter Chain ID != Solana", async function () {
            const redeemer = Keypair.generate();

            const amount = 69n;
            const message = new LiquidityLayerMessage({
                fastFill: {
                    fill: {
                        sourceChain: foreignChain,
                        orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
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
                "avalanche"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(
                connection,
                [ix],
                [payer, redeemer],
                "Error Code: InvalidEmitterForFastFill"
            );
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Emitter Address != Matching Engine Custodian", async function () {
            const redeemer = Keypair.generate();

            const amount = 69n;
            const message = new LiquidityLayerMessage({
                fastFill: {
                    fill: {
                        sourceChain: foreignChain,
                        orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
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
                Array.from(Buffer.alloc(32, "deadbeef", "hex")),
                wormholeSequence++,
                message,
                "solana"
            );
            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(
                connection,
                [ix],
                [payer, redeemer],
                "Error Code: InvalidEmitterForFastFill"
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
                "solana"
            );

            const redeemer = Keypair.generate();

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(connection, [ix], [payer, redeemer], "Error Code: InvalidVaa");
        });

        it("Token Router ..... Cannot Redeem Fast Fill with Invalid Payload", async function () {
            const redeemer = Keypair.generate();

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
                            redeemer: Array.from(redeemer.publicKey.toBuffer()),
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
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxErr(connection, [ix], [payer, redeemer], "Error Code: InvalidPayloadId");
        });
    });
});
