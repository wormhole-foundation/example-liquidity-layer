import * as wormholeSdk from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
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
    expectIxOk,
    postLiquidityLayerVaa,
} from "./helpers";
import * as splToken from "@solana/spl-token";

chaiUse(chaiAsPromised);

describe("Matching Engine <> Token Router", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    const ownerAssistant = OWNER_ASSISTANT_KEYPAIR;

    const foreignChain = wormholeSdk.CHAINS.ethereum;
    const thisChain = wormholeSdk.CHAINS.solana;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const foreignCctpDomain = 0;
    const unregisteredContractAddress = Buffer.alloc(32, "deafbeef", "hex");
    const tokenRouter = new tokenRouterSdk.TokenRouterProgram(connection);
    const matchingEngine = new matchingEngineSdk.MatchingEngineProgram(connection);

    let lookupTableAddress: PublicKey;

    describe("Admin", function () {
        describe("Matching Engine -- Add Solana Token Router Endpoint", function () {
            it("Add Solana Router Endpoint", async function () {
                const emitterAddress = Array.from(tokenRouter.custodianAddress().toBuffer());
                const ix = await matchingEngine.addRouterEndpointIx(
                    {
                        ownerOrAssistant: ownerAssistant.publicKey,
                        tokenRouterProgram: tokenRouter.ID,
                    },
                    { chain: thisChain, address: emitterAddress }
                );
                await expectIxOk(connection, [ix], [ownerAssistant]);

                const routerEndpointData = await matchingEngine.fetchRouterEndpoint(
                    matchingEngine.routerEndpointAddress(thisChain)
                );
                const expectedRouterEndpointData: matchingEngineSdk.RouterEndpoint = {
                    bump: 254,
                    chain: thisChain,
                    address: emitterAddress,
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

        it("Redeem Fast Fill", async function () {
            const redeemer = Keypair.generate();

            const amount = 69n;
            const fastFill: FastFill = {
                fill: {
                    sourceChain: foreignChain,
                    orderSender: Array.from(Buffer.alloc(32, "d00d", "hex")),
                    redeemer: Array.from(redeemer.publicKey.toBuffer()),
                    redeemerMessage: Buffer.from("Somebody set up us the bomb"),
                },
                amount,
            };
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

            await expectIxOk(connection, [ix], [payer, redeemer]);
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
