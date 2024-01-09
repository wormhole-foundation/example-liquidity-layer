import { CHAINS, ChainId } from "@certusone/wormhole-sdk";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { use as chaiUse, expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { AuctionConfig, Custodian, MatchingEngineProgram } from "../src/matching_engine";
import { LOCALHOST, PAYER_KEYPAIR, expectIxErr, expectIxOk } from "./helpers";

chaiUse(chaiAsPromised);

describe("Matching Engine", function () {
    const connection = new Connection(LOCALHOST, "processed");
    // payer is also the recipient in all tests
    const payer = PAYER_KEYPAIR;
    const owner = Keypair.generate();
    const ownerAssistant = Keypair.generate();
    const feeRecipient = Keypair.generate();

    const foreignChain = CHAINS.ethereum;
    const invalidChain = (foreignChain + 1) as ChainId;
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
                    owner: payer.publicKey,
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
                    [payer],
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
                    [payer],
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
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [payer],
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
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [payer],
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
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [payer],
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
                            owner: payer.publicKey,
                            ownerAssistant: ownerAssistant.publicKey,
                            feeRecipient: feeRecipient.publicKey,
                        }),
                    ],
                    [payer],
                    "InitialPenaltyTooLarge"
                );
            });

            it("Finally Initialize Program", async function () {
                await expectIxOk(connection, [await createInitializeIx()], [payer]);

                const custodianData = await engine.fetchCustodian(engine.custodianAddress());
                const expectedCustodianData = {
                    bump: 255,
                    owner: payer.publicKey,
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
                    [payer],
                    "already in use"
                );
            });
        });
    });
});
