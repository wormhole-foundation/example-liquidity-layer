import { CHAINS, ChainId } from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import {
    AuctionConfig,
    Custodian,
    RouterEndpoint,
    MatchingEngineProgram,
} from "../src/matching_engine";
import { LOCALHOST, PAYER_KEYPAIR, expectIxErr, expectIxOk } from "./helpers";

chaiUse(chaiAsPromised);

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // owner is also the recipient in all tests
    const owner = PAYER_KEYPAIR;
    const ownerAssistant = Keypair.generate();
    const robber = Keypair.generate();
    const feeRecipient = Keypair.generate();

    const foreignChain = CHAINS.ethereum;
    const routerEndpointAddress = Array.from(Buffer.alloc(32, "deadbeef", "hex"));
    const engine = new MatchingEngineProgram(connection);

    describe("Admin", function () {
        describe("Initialize", function () {
            const auctionConfig: AuctionConfig = {
                userPenaltyRewardBps: 250000,
                initialPenaltyBps: 250000,
                auctionDuration: 10,
                auctionGracePeriod: 30,
                auctionPenaltyBlocks: 60,
            };

            const createInitializeIx = (opts?: {
                ownerAssistant?: PublicKey;
                feeRecipient?: PublicKey;
            }) =>
                engine.initializeIx(auctionConfig, {
                    owner: owner.publicKey,
                    ownerAssistant: opts?.ownerAssistant ?? ownerAssistant.publicKey,
                    feeRecipient: opts?.feeRecipient ?? feeRecipient.publicKey,
                });

            it("Cannot Initialize With Default Owner Assistant", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createInitializeIx({
                            ownerAssistant: PublicKey.default,
                        }),
                    ],
                    [owner],
                    "AssistantZeroPubkey"
                );
            });

            it("Cannot Initialize With Default Fee Recipient", async function () {
                await expectIxErr(
                    connection,
                    [
                        await createInitializeIx({
                            feeRecipient: PublicKey.default,
                        }),
                    ],
                    [owner],
                    "FeeRecipientZeroPubkey"
                );
            });

            it("Cannot Initialize With Invalid Auction Duration", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.auctionDuration = 0;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: owner.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [owner],
                    "InvalidAuctionDuration"
                );
            });

            it("Cannot Initialize With Invalid Auction Grace Period", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.auctionGracePeriod = auctionConfig.auctionDuration - 1;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: owner.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [owner],
                    "InvalidAuctionGracePeriod"
                );
            });

            it("Cannot Initialize With Invalid User Penalty", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.userPenaltyRewardBps = 4294967295;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: owner.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [owner],
                    "UserPenaltyTooLarge"
                );
            });

            it("Cannot Initialize With Invalid Initial Penalty", async function () {
                const newAuctionConfig = { ...auctionConfig } as AuctionConfig;
                newAuctionConfig.initialPenaltyBps = 4294967295;

                await expectIxErr(
                    connection,
                    [
                        await engine.initializeIx(newAuctionConfig, {
                            owner: owner.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [owner],
                    "InitialPenaltyTooLarge"
                );
            });

            it("Finally Initialize Program", async function () {
                await expectIxOk(connection, [await createInitializeIx()], [owner]);

                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
                const expectedCustodianData = {
                    bump: 255,
                    owner: owner.publicKey,
                    pendingOwner: null,
                    ownerAssistant: ownerAssistant.publicKey,
                    feeRecipient: feeRecipient.publicKey,
                    auctionConfig: auctionConfig,
                } as Custodian;
                expect(custodianData).to.eql(expectedCustodianData);
            });

            it("Cannot Call Instruction Again: initialize", async function () {
                await expectIxErr(
                    connection,
                    [await createInitializeIx({})],
                    [owner],
                    "already in use"
                );
            });
        });

        describe("Add Router Endpoint", function () {
            const createAddRouterEndpointIx = (opts?: {
                sender?: PublicKey;
                contractAddress?: Array<number>;
            }) =>
                engine.addRouterEndpointIx(
                    {
                        ownerOrAssistant: opts?.sender ?? owner.publicKey,
                    },
                    {
                        chain: foreignChain,
                        address: opts?.contractAddress ?? routerEndpointAddress,
                    }
                );

            before("Transfer Lamports to Owner, Owner Assistant and Robber", async function () {
                await expectIxOk(
                    connection,
                    [
                        SystemProgram.transfer({
                            fromPubkey: owner.publicKey,
                            toPubkey: ownerAssistant.publicKey,
                            lamports: 1000000000,
                        }),
                        SystemProgram.transfer({
                            fromPubkey: owner.publicKey,
                            toPubkey: robber.publicKey,
                            lamports: 1000000000,
                        }),
                    ],
                    [owner]
                );
            });

            it("Cannot Add Router Endpoint as Non-Owner and Non-Assistant", async function () {
                await expectIxErr(
                    connection,
                    [await createAddRouterEndpointIx({ sender: robber.publicKey })],
                    [robber],
                    "OwnerOrAssistantOnly"
                );
            });

            it("Cannot Register Chain ID ==  0", async function () {
                const chain = 0;

                await expectIxErr(
                    connection,
                    [
                        await engine.addRouterEndpointIx(
                            { ownerOrAssistant: owner.publicKey },
                            { chain, address: routerEndpointAddress }
                        ),
                    ],
                    [owner],
                    "ChainNotAllowed"
                );
            });

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

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: contractAddress,
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

                const routerEndpointData = await engine.fetchRouterEndpoint(
                    engine.routerEndpointAddress(foreignChain)
                );
                const expectedRouterEndpointData = {
                    bump: 255,
                    chain: foreignChain,
                    address: routerEndpointAddress,
                } as RouterEndpoint;
                expect(routerEndpointData).to.eql(expectedRouterEndpointData);
            });
        });
    });
});
