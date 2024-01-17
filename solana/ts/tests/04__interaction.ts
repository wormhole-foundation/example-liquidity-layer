import * as wormholeSdk from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { CctpTokenBurnMessage, FastFill, LiquidityLayerMessage } from "../src";
import * as matchingEngineSdk from "../src/matchingEngine";
import * as tokenRouterSdk from "../src/tokenRouter";
import {
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
import * as splToken from "@solana/spl-token";
import { VaaAccount } from "../src/wormhole";

chaiUse(chaiAsPromised);

describe("Matching Engine <> Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const foreignCctpDomain = 0;
    const unregisteredContractAddress = Buffer.alloc(32, "deafbeef", "hex");
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(connection);
    const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(connection);

    let lookupTableAddress: PublicKey;

    describe("Admin", function () {
        describe("Matching Engine -- Add Local Token Router Endpoint", function () {
            it("Cannot Add Local Router Endpoint Without Executable", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
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
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: SystemProgram.programId,
                });
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    matchingEngine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
                );
                const [expectedAddress] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    SystemProgram.programId
                );
                const expectedRouterEndpointData: matchingEngineSdk.RouterEndpoint = {
                    bump: 254,
                    chain: wormholeSdk.CHAIN_ID_SOLANA,
                    address: Array.from(expectedAddress.toBuffer()),
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });

            it("Add Local Router Endpoint using SPL Token Program", async function () {
                const ix = await matchingEngine.addLocalRouterEndpointIx({
                    ownerOrAssistant: ownerAssistant.publicKey,
                    tokenRouterProgram: splToken.TOKEN_PROGRAM_ID,
                });
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    matchingEngine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
                );
                const [expectedAddress] = PublicKey.findProgramAddressSync(
                    [Buffer.from("emitter")],
                    splToken.TOKEN_PROGRAM_ID
                );
                const expectedRouterEndpointData: matchingEngineSdk.RouterEndpoint = {
                    bump: 254,
                    chain: wormholeSdk.CHAIN_ID_SOLANA,
                    address: Array.from(expectedAddress.toBuffer()),
                };
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });
        });
    });

    describe("Token Router -- Redeem Fast Fill", function () {
        const payerToken = splToken.getAssociatedTokenAddressSync(
            USDC_MINT_ADDRESS,
            payer.publicKey
        );

        let wormholeSequence = 4000n;

        const localVariables = new Map<string, any>();

        it("Cannot Redeem Fast Fill as Unregistered Token Router", async function () {
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

            // Save VAA pubkey and redeemer for later.
            localVariables.set("vaa", vaa);
            localVariables.set("redeemer", redeemer);
        });

        it("Remove Local Router Endpoint", async function () {
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

        it("Cannot Redeem Fast Fill without Local Router Endpoint", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            expect(localVariables.delete("vaa")).is.true;

            const redeemer = localVariables.get("redeemer") as Keypair;
            expect(localVariables.delete("redeemer")).is.true;

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

            // Save VAA pubkey and redeemer for later.
            localVariables.set("vaa", vaa);
            localVariables.set("redeemer", redeemer);
        });

        it("Add Local Router Endpoint using Token Router Program", async function () {
            const ix = await matchingEngine.addLocalRouterEndpointIx({
                ownerOrAssistant: ownerAssistant.publicKey,
                tokenRouterProgram: tokenRouter.ID,
            });
            await expectIxOk(connection, [ix], [ownerAssistant]);

            const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                matchingEngine.routerEndpointAddress(wormholeSdk.CHAIN_ID_SOLANA)
            );
            const expectedRouterEndpointData: matchingEngineSdk.RouterEndpoint = {
                bump: 254,
                chain: wormholeSdk.CHAIN_ID_SOLANA,
                address: Array.from(tokenRouter.custodianAddress().toBuffer()),
            };
            expect(routerEndpointData).to.eql(expectedRouterEndpointData);
        });

        it("Redeem Fast Fill", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            expect(localVariables.delete("vaa")).is.true;

            const redeemer = localVariables.get("redeemer") as Keypair;
            expect(localVariables.delete("redeemer")).is.true;

            const ix = await tokenRouter.redeemFastFillIx({
                payer: payer.publicKey,
                vaa,
                redeemer: redeemer.publicKey,
                dstToken: payerToken,
            });

            await expectIxOk(connection, [ix], [payer, redeemer]);

            // Save VAA pubkey and redeemer for later.
            localVariables.set("vaa", vaa);
            localVariables.set("redeemer", redeemer);
        });

        it("Cannot Redeem Same Fast Fill Again", async function () {
            const vaa = localVariables.get("vaa") as PublicKey;
            expect(localVariables.delete("vaa")).is.true;

            const redeemer = localVariables.get("redeemer") as Keypair;
            expect(localVariables.delete("redeemer")).is.true;

            const vaaHash = await VaaAccount.fetch(connection, vaa).then((vaa) => vaa.digest());

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
                `Allocate: account Address { address: ${matchingEngine
                    .redeemedFastFillAddress(vaaHash)
                    .toString()}, base: None } already in use`
            );
        });
    });
});

async function craftCctpTokenBurnMessage(
    tokenRouter: tokenRouterSdk.TokenRouterProgram,
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
    const sourceTokenMessenger = await tokenMessengerMinterProgram
        .fetchRemoteTokenMessenger(
            tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceCctpDomain)
        )
        .then((remote) => remote.tokenMessenger);

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

    return {
        destinationCctpDomain,
        burnMessage,
        encodedCctpMessage,
    };
}
