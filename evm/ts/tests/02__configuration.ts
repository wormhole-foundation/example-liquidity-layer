import { ethers } from "ethers";
import { ITokenRouter__factory, IMatchingEngine__factory } from "../src/types";
import {
    LOCALHOSTS,
    OWNER_ASSISTANT_PRIVATE_KEY,
    mineWait,
    ValidNetwork,
    MATCHING_ENGINE_NAME,
    DEFAULT_AUCTION_CONFIG,
    DEFAULT_FAST_TRANSFER_PARAMS,
} from "./helpers";
import { expect } from "chai";

import { parseLiquidityLayerEnvFile } from "../src";

const CHAIN_PATHWAYS: ValidNetwork[] = ["ethereum", "avalanche", "arbitrum"];

describe("Registration", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    describe(`Matching Engine Configuration`, () => {
        const env = parseLiquidityLayerEnvFile(`${envPath}/${MATCHING_ENGINE_NAME}.env`);
        const provider = new ethers.providers.StaticJsonRpcProvider(
            LOCALHOSTS[MATCHING_ENGINE_NAME]
        );
        const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);
        const engine = IMatchingEngine__factory.connect(env.matchingEngineAddress, assistant);

        it(`Set Auction Config`, async () => {
            await engine
                .setAuctionConfig(DEFAULT_AUCTION_CONFIG)
                .then((tx) => mineWait(provider, tx));

            const state = await engine.auctionConfig();
            expect(state.userPenaltyRewardBps).to.equal(
                DEFAULT_AUCTION_CONFIG.userPenaltyRewardBps
            );
            expect(state.initialPenaltyBps).to.equal(DEFAULT_AUCTION_CONFIG.initialPenaltyBps);
            expect(state.auctionDuration).to.equal(DEFAULT_AUCTION_CONFIG.auctionDuration);
            expect(state.auctionGracePeriod).to.equal(DEFAULT_AUCTION_CONFIG.auctionGracePeriod);
            expect(state.penaltyBlocks).to.equal(DEFAULT_AUCTION_CONFIG.penaltyBlocks);
        });
    });

    describe("Token Router Configuration", () => {
        for (const chainName of CHAIN_PATHWAYS) {
            const env = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);
            const provider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS[chainName]);
            const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);
            const router = ITokenRouter__factory.connect(env.tokenRouterAddress, assistant);

            it(`Set Fast Transfer Parameters For ${chainName}`, async () => {
                await router
                    .updateFastTransferParameters(DEFAULT_FAST_TRANSFER_PARAMS)
                    .then((tx) => mineWait(provider, tx));

                const state = await router.getFastTransferParameters();
                expect(state.enabled).to.equal(DEFAULT_FAST_TRANSFER_PARAMS.enabled);
                expect(state.maxAmount.toString()).to.equal(
                    DEFAULT_FAST_TRANSFER_PARAMS.maxAmount.toString()
                );
                expect(state.baseFee.toString()).to.equal(
                    DEFAULT_FAST_TRANSFER_PARAMS.baseFee.toString()
                );
                expect(state.initAuctionFee.toString()).to.equal(
                    DEFAULT_FAST_TRANSFER_PARAMS.initAuctionFee.toString()
                );
            });
        }
    });
});
