import {
    coalesceChainId,
    parseVaa,
    keccak256,
    tryNativeToUint8Array,
} from "@certusone/wormhole-sdk";
import { expect } from "chai";
import { ethers } from "ethers";
import {
    ChainType,
    EvmTokenRouter,
    EvmMatchingEngine,
    errorDecoder,
    parseLiquidityLayerEnvFile,
    OrderResponse,
    MessageDecoder,
} from "../src";
import { IERC20__factory } from "../src/types";
import {
    CircleAttester,
    GuardianNetwork,
    LOCALHOSTS,
    MATCHING_ENGINE_CHAIN,
    MATCHING_ENGINE_NAME,
    ScoreKeeper,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    burnAllUsdc,
    mineWait,
    mine,
    mintNativeUsdc,
    mineToGracePeriod,
    mineToPenaltyPeriod,
} from "./helpers";

// Cannot send a fast market order from the matching engine chain.
const CHAIN_PATHWAYS: ValidNetwork[][] = [
    ["arbitrum", "ethereum"],
    ["ethereum", "arbitrum"],
    ["arbitrum", "avalanche"],
    ["ethereum", "avalanche"],
];

const TEST_AMOUNT = ethers.utils.parseUnits("1000", 6);
const FEE_AMOUNT = BigInt(ethers.utils.parseUnits("10", 6).toString());

describe("Fast Market Order Business Logic -- CCTP to CCTP", function (this: Mocha.Suite) {
    const envPath = `${__dirname}/../../env/localnet`;

    const guardianNetwork = new GuardianNetwork();
    const circleAttester = new CircleAttester();

    // Matching Engine configuration.
    const engineProvider = new ethers.providers.StaticJsonRpcProvider(
        LOCALHOSTS[MATCHING_ENGINE_NAME]
    );
    const engineWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[2], engineProvider);
    const engineEnv = parseLiquidityLayerEnvFile(`${envPath}/${MATCHING_ENGINE_NAME}.env`);
    const engine = (() => {
        if (engineEnv.chainType === ChainType.Evm) {
            return new EvmMatchingEngine(
                engineWallet,
                engineEnv.matchingEngineAddress,
                engineEnv.tokenMessengerAddress
            );
        } else {
            throw new Error("Unsupported chain");
        }
    })();

    // Auction participants.
    const initialBidder = new ethers.Wallet(WALLET_PRIVATE_KEYS[3], engineProvider);
    const bidderTwo = new ethers.Wallet(WALLET_PRIVATE_KEYS[4], engineProvider);
    const bidderThree = new ethers.Wallet(WALLET_PRIVATE_KEYS[5], engineProvider);
    const highestBidder = new ethers.Wallet(WALLET_PRIVATE_KEYS[6], engineProvider);
    const liquidator = new ethers.Wallet(WALLET_PRIVATE_KEYS[7], engineProvider);

    for (const [fromChainName, toChainName] of CHAIN_PATHWAYS) {
        const localVariables = new Map<string, any>();

        describe(`${fromChainName} <> ${toChainName}`, () => {
            // From setup.
            const fromProvider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[fromChainName]
            );
            const fromWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[0], fromProvider);

            const fromEnv = parseLiquidityLayerEnvFile(`${envPath}/${fromChainName}.env`);
            const fromTokenRouter = (() => {
                if (fromEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(
                        fromWallet,
                        fromEnv.tokenRouterAddress,
                        fromEnv.tokenMessengerAddress
                    );
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            // To setup.
            const toProvider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS[toChainName]);
            const toWallet = new ethers.Wallet(WALLET_PRIVATE_KEYS[1], toProvider);

            const toEnv = parseLiquidityLayerEnvFile(`${envPath}/${toChainName}.env`);
            const toTokenRouter = (() => {
                if (toEnv.chainType === ChainType.Evm) {
                    return new EvmTokenRouter(
                        toWallet,
                        toEnv.tokenRouterAddress,
                        fromEnv.tokenMessengerAddress
                    );
                } else {
                    throw new Error("Unsupported chain");
                }
            })();

            describe(`Successful Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType == ChainType.Evm) {
                            const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                            const amount = await usdc.balanceOf(fromWallet.address);
                            await usdc
                                .approve(fromTokenRouter.address, amount)
                                .then((tx) => mineWait(fromProvider, tx));

                            return BigInt(amount.toString());
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })();
                    localVariables.set("amountIn", amountIn);

                    const targetChain = coalesceChainId(toChainName);
                    const minAmountOut = BigInt(0);
                    const deadline = 0;
                    const receipt = await fromTokenRouter
                        .placeFastMarketOrder(
                            amountIn,
                            targetChain,
                            Buffer.from(tryNativeToUint8Array(toWallet.address, toChainName)),
                            Buffer.from("All your base are belong to us."),
                            FEE_AMOUNT,
                            deadline,
                            minAmountOut,
                            fromWallet.address
                        )
                        .then((tx) => mineWait(fromProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt.transactionHash
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName)
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse"
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set("fastVaa", fastVaa);
                });

                it(`Matching Engine -- Start Fast Order Auction`, async () => {
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;

                    // Parse the vaa, we will need the hash for later.
                    const parsedFastVaa = parseVaa(fastVaa);
                    localVariables.set("auctionId", keccak256(parsedFastVaa.hash));
                    const fastOrder = MessageDecoder.unsafeDecodeFastPayload(parsedFastVaa.payload)
                        .body.fastMarketOrder;

                    if (fastOrder === undefined) {
                        throw new Error("Fast order undefined");
                    }

                    // Security deposit amount of the initial bid.
                    const initialDeposit = fastOrder.amountIn + fastOrder.maxFee;

                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, initialBidder);
                    await mintNativeUsdc(usdc, initialBidder.address, initialDeposit);
                    await usdc.approve(engine.address, initialDeposit);

                    const balanceBefore = await usdc.balanceOf(initialBidder.address);

                    const receipt = await engine
                        .connect(initialBidder)
                        .placeInitialBid(fastVaa, fastOrder.maxFee)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const balanceAfter = await usdc.balanceOf(initialBidder.address);
                    expect(balanceBefore.sub(balanceAfter).toString()).to.eql(
                        initialDeposit.toString()
                    );

                    // Validate state changes.
                    const auctionData = await engine.liveAuctionInfo(
                        localVariables.get("auctionId")
                    );

                    expect(auctionData.status).to.eql(1);
                    expect(auctionData.startBlock.toString()).to.eql(
                        receipt.blockNumber.toString()
                    );
                    expect(auctionData.highestBidder).to.eql(initialBidder.address);
                    expect(auctionData.initialBidder).to.eql(initialBidder.address);
                    expect(auctionData.amount.toString()).to.eql(fastOrder.amountIn.toString());
                    expect(auctionData.securityDeposit.toString()).to.eql(
                        fastOrder.maxFee.toString()
                    );
                    expect(auctionData.bidPrice.toString()).to.eql(fastOrder.maxFee.toString());
                });

                it(`Matching Engine -- Fast Order Auction Period`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    const auctionInfoBefore = await engine.liveAuctionInfo(auctionId);
                    const startingBid = ethers.BigNumber.from(auctionInfoBefore.bidPrice);
                    const initialDeposit = ethers.BigNumber.from(auctionInfoBefore.amount).add(
                        ethers.BigNumber.from(auctionInfoBefore.securityDeposit)
                    );
                    expect(startingBid.gt(0) && initialDeposit.gt(0)).is.true;

                    // Create array of test bids. This structure should not change, otherwise
                    // the following tests will fail.
                    const bids: ScoreKeeper[] = [
                        {
                            player: bidderTwo,
                            bid: startingBid.sub(1),
                            balance: ethers.BigNumber.from(0),
                        },
                        {
                            player: bidderThree,
                            bid: startingBid.div(2),
                            balance: ethers.BigNumber.from(0),
                        },
                        {
                            player: highestBidder,
                            bid: startingBid.div(3),
                            balance: ethers.BigNumber.from(0),
                        },
                    ];

                    // Loop through and make multiple bids in the same block.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        await mintNativeUsdc(usdc, player.address, initialDeposit, false);
                        await usdc.approve(engine.address, initialDeposit);

                        bids[i].balance = await usdc.balanceOf(player.address);

                        // Improve the bid.
                        await engine.connect(player).improveBid(auctionId, bids[i].bid);
                    }

                    // Mine the block.
                    await mine(engineProvider);

                    // Validate balance changes. The lowest bid should have zero balance, the others
                    // should've been refunded.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        const balanceAfter = await usdc.balanceOf(player.address);

                        if (i == 2) {
                            expect(balanceAfter.sub(bids[i].balance).toString()).to.eql("0");
                        } else {
                            expect(balanceAfter.toString()).to.eql(
                                bids[i].balance.add(initialDeposit).toString()
                            );
                        }
                    }

                    // Validate state changes.
                    const auctionInfoAfter = await engine.liveAuctionInfo(auctionId);

                    expect(auctionInfoAfter.status).to.eql(1);
                    expect(auctionInfoAfter.startBlock.toString()).to.eql(
                        auctionInfoBefore.startBlock.toString()
                    );
                    expect(auctionInfoAfter.highestBidder).to.eql(highestBidder.address);
                    expect(auctionInfoAfter.initialBidder).to.eql(auctionInfoBefore.initialBidder);
                    expect(auctionInfoAfter.amount.toString()).to.eql(
                        auctionInfoBefore.amount.toString()
                    );
                    expect(auctionInfoAfter.securityDeposit.toString()).to.eql(
                        auctionInfoBefore.securityDeposit.toString()
                    );
                    expect(auctionInfoAfter.bidPrice.toString()).to.eql(bids[2].bid.toString());
                });

                it(`Matching Engine -- Execute Fast Order Within Grace Period`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    await mineToGracePeriod(auctionId, engine, engineProvider);

                    // Fetch the initial bidder so we can do a balance check.
                    const auctionInfo = await engine.liveAuctionInfo(auctionId);

                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, highestBidder);
                    const balanceBefore = await usdc.balanceOf(highestBidder.address);
                    const initialBidderBefore = await usdc.balanceOf(auctionInfo.initialBidder);

                    const receipt = await engine
                        .connect(highestBidder)
                        .executeFastOrder(localVariables.get("fastVaa"))
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const transactionResult = await engine.getTransactionResults(
                        receipt.transactionHash
                    );

                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Validate state and balance changes.
                    const balanceAfter = await usdc.balanceOf(highestBidder.address);
                    const initialBidderAfter = await usdc.balanceOf(auctionInfo.initialBidder);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();

                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        ethers.BigNumber.from(auctionInfo.bidPrice)
                            .add(ethers.BigNumber.from(auctionInfo.securityDeposit))
                            .toString()
                    );
                    expect(initialBidderAfter.sub(initialBidderBefore).eq(initAuctionFee)).is.true;

                    // Auction status should be complete (2).
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2);

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    localVariables.set("fastOrderResponse", orderResponse);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    expect(localVariables.delete("fastOrderResponse")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const receipt = await toTokenRouter
                        .redeemFill(orderResponse)
                        .then((tx) => mineWait(toProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Validate balance changes.
                    const [bidPrice, amount] = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => [
                            ethers.BigNumber.from(info.bidPrice),
                            ethers.BigNumber.from(info.amount),
                        ]);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        amount.sub(bidPrice).sub(initAuctionFee).toString()
                    );
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;
                    expect(localVariables.delete("auctionId")).is.true;

                    // Fetch balance of player four since they were the highest bidder.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const balanceBefore = await usdc.balanceOf(highestBidder.address);
                    const expectedAmount = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.amount);

                    const receipt = await engine
                        .executeSlowOrderAndRedeem(fastVaa, params)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const balanceAfter = await usdc.balanceOf(highestBidder.address);
                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        expectedAmount.toString()
                    );
                });
            });

            describe(`Penalized Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType == ChainType.Evm) {
                            const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                            const amount = await usdc.balanceOf(fromWallet.address);
                            await usdc
                                .approve(fromTokenRouter.address, amount)
                                .then((tx) => mineWait(fromProvider, tx));

                            return BigInt(amount.toString());
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })();
                    localVariables.set("amountIn", amountIn);

                    const targetChain = coalesceChainId(toChainName);
                    const minAmountOut = BigInt(0);
                    const deadline = 0;
                    const receipt = await fromTokenRouter
                        .placeFastMarketOrder(
                            amountIn,
                            targetChain,
                            Buffer.from(tryNativeToUint8Array(toWallet.address, toChainName)),
                            Buffer.from("All your base are belong to us."),
                            FEE_AMOUNT,
                            deadline,
                            minAmountOut,
                            fromWallet.address
                        )
                        .then((tx) => mineWait(fromProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt.transactionHash
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName)
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse"
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set("fastVaa", fastVaa);
                });

                it(`Matching Engine -- Start Fast Order Auction`, async () => {
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;

                    // Parse the vaa, we will need the hash for later.
                    const parsedFastVaa = parseVaa(fastVaa);
                    localVariables.set("auctionId", keccak256(parsedFastVaa.hash));
                    const fastOrder = MessageDecoder.unsafeDecodeFastPayload(parsedFastVaa.payload)
                        .body.fastMarketOrder;

                    if (fastOrder === undefined) {
                        throw new Error("Fast order undefined");
                    }

                    // Security deposit amount of the initial bid.
                    const initialDeposit = fastOrder.amountIn + fastOrder.maxFee;

                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, initialBidder);
                    await mintNativeUsdc(usdc, initialBidder.address, initialDeposit);
                    await usdc.approve(engine.address, initialDeposit);

                    const balanceBefore = await usdc.balanceOf(initialBidder.address);

                    const receipt = await engine
                        .connect(initialBidder)
                        .placeInitialBid(fastVaa, fastOrder.maxFee)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const balanceAfter = await usdc.balanceOf(initialBidder.address);
                    expect(balanceBefore.sub(balanceAfter).toString()).to.eql(
                        initialDeposit.toString()
                    );

                    // Validate state changes.
                    const auctionData = await engine.liveAuctionInfo(
                        localVariables.get("auctionId")
                    );

                    expect(auctionData.status).to.eql(1);
                    expect(auctionData.startBlock.toString()).to.eql(
                        receipt.blockNumber.toString()
                    );
                    expect(auctionData.highestBidder).to.eql(initialBidder.address);
                    expect(auctionData.initialBidder).to.eql(initialBidder.address);
                    expect(auctionData.amount.toString()).to.eql(fastOrder.amountIn.toString());
                    expect(auctionData.securityDeposit.toString()).to.eql(
                        fastOrder.maxFee.toString()
                    );
                    expect(auctionData.bidPrice.toString()).to.eql(fastOrder.maxFee.toString());
                });

                it(`Matching Engine -- Fast Order Auction Period`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    const auctionInfoBefore = await engine.liveAuctionInfo(auctionId);
                    const startingBid = ethers.BigNumber.from(auctionInfoBefore.bidPrice);
                    const initialDeposit = ethers.BigNumber.from(auctionInfoBefore.amount).add(
                        ethers.BigNumber.from(auctionInfoBefore.securityDeposit)
                    );
                    expect(startingBid.gt(0) && initialDeposit.gt(0)).is.true;

                    // Create array of test bids. This structure should not change, otherwise
                    // the following tests will fail.
                    const bids: ScoreKeeper[] = [
                        {
                            player: bidderTwo,
                            bid: startingBid.sub(1),
                            balance: ethers.BigNumber.from(0),
                        },
                        {
                            player: bidderThree,
                            bid: startingBid.div(2),
                            balance: ethers.BigNumber.from(0),
                        },
                        {
                            player: highestBidder,
                            bid: startingBid.div(3),
                            balance: ethers.BigNumber.from(0),
                        },
                    ];

                    // Loop through and make multiple bids in the same block.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        await mintNativeUsdc(usdc, player.address, initialDeposit, false);
                        await usdc.approve(engine.address, initialDeposit);

                        bids[i].balance = await usdc.balanceOf(player.address);

                        // Improve the bid.
                        await engine.connect(player).improveBid(auctionId, bids[i].bid);
                    }

                    // Mine the block.
                    await mine(engineProvider);

                    // Validate balance changes. The lowest bid should have zero balance, the others
                    // should've been refunded.
                    for (let i = 0; i < bids.length; i++) {
                        const player = bids[i].player;
                        const usdc = IERC20__factory.connect(engineEnv.tokenAddress, player);
                        const balanceAfter = await usdc.balanceOf(player.address);

                        if (i == 2) {
                            expect(balanceAfter.sub(bids[i].balance).toString()).to.eql("0");
                        } else {
                            expect(balanceAfter.toString()).to.eql(
                                bids[i].balance.add(initialDeposit).toString()
                            );
                        }
                    }

                    // Validate state changes.
                    const auctionInfoAfter = await engine.liveAuctionInfo(auctionId);

                    expect(auctionInfoAfter.status).to.eql(1);
                    expect(auctionInfoAfter.startBlock.toString()).to.eql(
                        auctionInfoBefore.startBlock.toString()
                    );
                    expect(auctionInfoAfter.highestBidder).to.eql(highestBidder.address);
                    expect(auctionInfoAfter.initialBidder).to.eql(auctionInfoBefore.initialBidder);
                    expect(auctionInfoAfter.amount.toString()).to.eql(
                        auctionInfoBefore.amount.toString()
                    );
                    expect(auctionInfoAfter.securityDeposit.toString()).to.eql(
                        auctionInfoBefore.securityDeposit.toString()
                    );
                    expect(auctionInfoAfter.bidPrice.toString()).to.eql(bids[2].bid.toString());
                });

                it(`Matching Engine -- Execute Fast Order As Liquidator (After Grace Period Ends)`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;

                    // Mine 50% of the way through the penalty period.
                    await engine
                        .getPenaltyBlocks()
                        .then((blocks) =>
                            mineToPenaltyPeriod(auctionId, engine, engineProvider, blocks / 2)
                        );

                    // Fetch the initial bidder so we can do a balance check.
                    const auctionInfo = await engine.liveAuctionInfo(auctionId);

                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, highestBidder);
                    const balanceBefore = await usdc.balanceOf(highestBidder.address);
                    const balanceLiquidatorBefore = await usdc.balanceOf(liquidator.address);
                    const initialBidderBefore = await usdc.balanceOf(auctionInfo.initialBidder);

                    const receipt = await engine
                        .connect(liquidator)
                        .executeFastOrder(localVariables.get("fastVaa"))
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const [penalty, reward] = await engine.calculateDynamicPenalty(auctionId);

                    const transactionResult = await engine.getTransactionResults(
                        receipt.transactionHash
                    );

                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Validate state and balance changes.
                    const balanceAfter = await usdc.balanceOf(highestBidder.address);
                    const initialBidderAfter = await usdc.balanceOf(auctionInfo.initialBidder);
                    const balanceLiquidatorAfter = await usdc.balanceOf(liquidator.address);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();

                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        ethers.BigNumber.from(auctionInfo.bidPrice)
                            .add(ethers.BigNumber.from(auctionInfo.securityDeposit))
                            .sub(ethers.BigNumber.from(penalty).add(ethers.BigNumber.from(reward)))
                            .toString()
                    );
                    expect(balanceLiquidatorAfter.sub(balanceLiquidatorBefore).toString()).to.eql(
                        penalty.toString()
                    );
                    expect(initialBidderAfter.sub(initialBidderBefore).eq(initAuctionFee)).is.true;

                    // Auction status should be complete (2).
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2);

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("reward", reward);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const reward = localVariables.get("reward") as string;
                    expect(localVariables.delete("reward")).is.true;
                    expect(localVariables.delete("fastOrderResponse")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const receipt = await toTokenRouter
                        .redeemFill(orderResponse)
                        .then((tx) => mineWait(toProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Validate balance changes.
                    const [bidPrice, amount] = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => [
                            ethers.BigNumber.from(info.bidPrice),
                            ethers.BigNumber.from(info.amount),
                        ]);
                    const initAuctionFee = await fromTokenRouter.getInitialAuctionFee();
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    // Add the reward, since the fast auction wasn't executed during
                    // the grace period.
                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        amount.sub(bidPrice).sub(initAuctionFee).add(reward).toString()
                    );
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const auctionId = localVariables.get("auctionId") as Uint8Array;
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;
                    expect(localVariables.delete("auctionId")).is.true;

                    // Fetch balance of player four since they were the highest bidder.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const balanceBefore = await usdc.balanceOf(highestBidder.address);
                    const expectedAmount = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.amount);

                    const receipt = await engine
                        .executeSlowOrderAndRedeem(fastVaa, params)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    const balanceAfter = await usdc.balanceOf(highestBidder.address);
                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        expectedAmount.toString()
                    );
                });
            });

            describe(`No Auction`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType == ChainType.Evm) {
                            const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                            const amount = await usdc.balanceOf(fromWallet.address);
                            await usdc
                                .approve(fromTokenRouter.address, amount)
                                .then((tx) => mineWait(fromProvider, tx));

                            return BigInt(amount.toString());
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })();
                    localVariables.set("amountIn", amountIn);

                    const targetChain = coalesceChainId(toChainName);
                    const minAmountOut = BigInt(0);
                    const deadline = 0;
                    const receipt = await fromTokenRouter
                        .placeFastMarketOrder(
                            amountIn,
                            targetChain,
                            Buffer.from(tryNativeToUint8Array(toWallet.address, toChainName)),
                            Buffer.from("All your base are belong to us."),
                            FEE_AMOUNT,
                            deadline,
                            minAmountOut,
                            fromWallet.address
                        )
                        .then((tx) => mineWait(fromProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt.transactionHash
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName)
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse"
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set("fastVaa", fastVaa);
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;

                    // NOTE: Imagine that several minutes have passed, and no auction has been started :).

                    // Parse the slow VAA for the baseFee and amount
                    const baseFee = MessageDecoder.unsafeDecodeWormholeCctpPayload(
                        parseVaa(params.encodedWormholeMessage).payload
                    ).body.slowOrderResponse!.baseFee;

                    // Use player one as the relayer.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const feeRecipientBefore = await usdc.balanceOf(engineEnv.feeRecipient!);

                    const receipt = await engine
                        .connect(initialBidder)
                        .executeSlowOrderAndRedeem(fastVaa, params)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Balance check.
                    const feeRecipientAfter = await usdc.balanceOf(engineEnv.feeRecipient!);
                    expect(feeRecipientAfter.sub(feeRecipientBefore).toString()).to.eql(
                        baseFee.toString()
                    );

                    const transactionResult = await engine.getTransactionResults(
                        receipt.transactionHash
                    );

                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    // Confirm that the auction was market as complete.
                    const auctionId = keccak256(parseVaa(fastVaa).hash);
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2);

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("baseFee", baseFee);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const baseFee = localVariables.get("baseFee") as string;
                    expect(localVariables.delete("fastOrderResponse")).is.true;
                    expect(localVariables.delete("baseFee")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const receipt = await toTokenRouter
                        .redeemFill(orderResponse)
                        .then((tx) => mineWait(toProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Validate balance changes.
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        TEST_AMOUNT.sub(baseFee).toString()
                    );
                });
            });

            describe(`No Auction - Deadline Exceeded`, () => {
                before(`From Network -- Mint USDC`, async () => {
                    if (fromEnv.chainId == MATCHING_ENGINE_CHAIN) {
                        console.log("Skipfrom outbound tests from Matching Engine.");
                        this.ctx.skip();
                    }

                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);

                    await burnAllUsdc(usdc);

                    await mintNativeUsdc(
                        IERC20__factory.connect(fromEnv.tokenAddress, fromProvider),
                        fromWallet.address,
                        TEST_AMOUNT
                    );
                });

                after(`Burn USDC`, async () => {
                    const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                    await burnAllUsdc(usdc);
                });

                it(`From Network -- Place Fast Market Order`, async () => {
                    const amountIn = await (async () => {
                        if (fromEnv.chainType == ChainType.Evm) {
                            const usdc = IERC20__factory.connect(fromEnv.tokenAddress, fromWallet);
                            const amount = await usdc.balanceOf(fromWallet.address);
                            await usdc
                                .approve(fromTokenRouter.address, amount)
                                .then((tx) => mineWait(fromProvider, tx));

                            return BigInt(amount.toString());
                        } else {
                            throw new Error("Unsupported chain");
                        }
                    })();
                    localVariables.set("amountIn", amountIn);

                    const targetChain = coalesceChainId(toChainName);
                    const minAmountOut = BigInt(0);

                    // Set the deadline to the current block timestamp.
                    const currentBlock = await engineProvider.getBlockNumber();
                    const deadline = (await engineProvider.getBlock(currentBlock)).timestamp;

                    const receipt = await fromTokenRouter
                        .placeFastMarketOrder(
                            amountIn,
                            targetChain,
                            Buffer.from(tryNativeToUint8Array(toWallet.address, toChainName)),
                            Buffer.from("All your base are belong to us."),
                            FEE_AMOUNT,
                            deadline!,
                            minAmountOut,
                            fromWallet.address
                        )
                        .then((tx) => mineWait(fromProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });
                    const transactionResult = await fromTokenRouter.getTransactionResults(
                        receipt.transactionHash
                    );
                    expect(transactionResult.wormhole.emitterAddress).to.eql(
                        tryNativeToUint8Array(fromEnv.tokenRouterAddress, fromChainName)
                    );
                    expect(transactionResult.wormhole.message.body).has.property(
                        "slowOrderResponse"
                    );
                    expect(transactionResult.circleMessage).is.not.undefined;
                    expect(transactionResult.fastMessage).is.not.undefined;

                    const signedVaas = await guardianNetwork.observeManyEvm(
                        fromProvider,
                        fromChainName,
                        receipt
                    );
                    expect(signedVaas.length).to.eql(2);

                    // The first message is the slow CCTP transfer.
                    const [slowOrderResponse, fastVaa] = signedVaas;

                    const circleBridgeMessage = transactionResult.circleMessage!;
                    const circleAttestation = circleAttester.createAttestation(circleBridgeMessage);

                    const redeemParameters: OrderResponse = {
                        encodedWormholeMessage: slowOrderResponse,
                        circleBridgeMessage,
                        circleAttestation,
                    };
                    localVariables.set("redeemParameters", redeemParameters);
                    localVariables.set("fastVaa", fastVaa);
                });

                it(`Matching Engine -- Attempt to Start Auction After Deadline`, async () => {
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;

                    // Parse the vaa, we will need the hash for later.
                    const parsedFastVaa = parseVaa(fastVaa);
                    localVariables.set("auctionId", keccak256(parsedFastVaa.hash));
                    const fastOrder = MessageDecoder.unsafeDecodeFastPayload(parsedFastVaa.payload)
                        .body.fastMarketOrder;

                    if (fastOrder === undefined) {
                        throw new Error("Fast order undefined");
                    }

                    // Security deposit amount of the initial bid.
                    const initialDeposit = fastOrder.amountIn + fastOrder.maxFee;

                    // Prepare usdc for the auction.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, initialBidder);
                    await mintNativeUsdc(usdc, initialBidder.address, initialDeposit);
                    await usdc.approve(engine.address, initialDeposit);

                    let failedGracefully = false;
                    const receipt = await engine
                        .connect(initialBidder)
                        .placeInitialBid(fastVaa, fastOrder.maxFee)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            const error = errorDecoder(err);
                            if (error.selector == "ErrDeadlineExceeded") {
                                failedGracefully = true;
                            }
                        });

                    expect(failedGracefully).is.true;
                });

                it(`Matching Engine -- Execute Slow Vaa And Redeem`, async () => {
                    const fastVaa = localVariables.get("fastVaa") as Uint8Array;
                    const params = localVariables.get("redeemParameters") as OrderResponse;
                    expect(localVariables.delete("redeemParameters")).is.true;
                    expect(localVariables.delete("fastVaa")).is.true;

                    // NOTE: Imagine that several minutes have passed, and no auction has been started :).

                    // Parse the slow VAA for the baseFee and amount
                    const baseFee = MessageDecoder.unsafeDecodeWormholeCctpPayload(
                        parseVaa(params.encodedWormholeMessage).payload
                    ).body.slowOrderResponse!.baseFee;

                    // Use player one as the relayer.
                    const usdc = IERC20__factory.connect(engineEnv.tokenAddress, engineProvider);
                    const feeRecipientBefore = await usdc.balanceOf(engineEnv.feeRecipient!);

                    const receipt = await engine
                        .connect(initialBidder)
                        .executeSlowOrderAndRedeem(fastVaa, params)
                        .then((tx) => mineWait(engineProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Balance check.
                    const feeRecipientAfter = await usdc.balanceOf(engineEnv.feeRecipient!);
                    expect(feeRecipientAfter.sub(feeRecipientBefore).toString()).to.eql(
                        baseFee.toString()
                    );

                    const transactionResult = await engine.getTransactionResults(
                        receipt.transactionHash
                    );

                    if (toChainName == MATCHING_ENGINE_NAME) {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fastFill");
                        expect(transactionResult.circleMessage).is.undefined;
                    } else {
                        expect(transactionResult.wormhole.emitterAddress).to.eql(
                            tryNativeToUint8Array(engine.address, MATCHING_ENGINE_NAME)
                        );
                        expect(transactionResult.wormhole.message.body).has.property("fill");
                        expect(transactionResult.circleMessage).is.not.undefined;
                    }

                    expect(transactionResult.fastMessage).is.undefined;

                    // Fetch and store the vaa for redeeming the fill.
                    const signedVaa = await guardianNetwork.observeEvm(
                        engineProvider,
                        MATCHING_ENGINE_NAME,
                        receipt
                    );

                    let orderResponse: OrderResponse;
                    if (toChainName == MATCHING_ENGINE_NAME) {
                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage: Buffer.from(""),
                            circleAttestation: Buffer.from(""),
                        };
                    } else {
                        const circleBridgeMessage = transactionResult.circleMessage!;
                        const circleAttestation =
                            circleAttester.createAttestation(circleBridgeMessage);

                        orderResponse = {
                            encodedWormholeMessage: signedVaa,
                            circleBridgeMessage,
                            circleAttestation,
                        };
                    }

                    // Confirm that the auction was market as complete.
                    const auctionId = keccak256(parseVaa(fastVaa).hash);
                    const auctionStatus = await engine
                        .liveAuctionInfo(auctionId)
                        .then((info) => info.status);
                    expect(auctionStatus).to.eql(2);

                    localVariables.set("fastOrderResponse", orderResponse);
                    localVariables.set("baseFee", baseFee);
                });

                it(`To Network -- Redeem Fill`, async () => {
                    const orderResponse = localVariables.get("fastOrderResponse") as OrderResponse;
                    const baseFee = localVariables.get("baseFee") as string;
                    expect(localVariables.delete("fastOrderResponse")).is.true;
                    expect(localVariables.delete("baseFee")).is.true;

                    const usdc = IERC20__factory.connect(toEnv.tokenAddress, toProvider);
                    const balanceBefore = await usdc.balanceOf(toWallet.address);

                    const receipt = await toTokenRouter
                        .redeemFill(orderResponse)
                        .then((tx) => mineWait(toProvider, tx))
                        .catch((err) => {
                            console.log(err);
                            console.log(errorDecoder(err));
                            throw err;
                        });

                    // Validate balance changes.
                    const balanceAfter = await usdc.balanceOf(toWallet.address);

                    expect(balanceAfter.sub(balanceBefore).toString()).to.eql(
                        TEST_AMOUNT.sub(baseFee).toString()
                    );
                });
            });
        });
    }
});
