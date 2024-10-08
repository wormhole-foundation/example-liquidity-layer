import { ethers } from "ethers";
import { ITokenRouter__factory, IMatchingEngine__factory } from "../src/types";
import {
    LOCALHOSTS,
    OWNER_ASSISTANT_PRIVATE_KEY,
    mineWait,
    ValidNetwork,
    DEFAULT_FAST_TRANSFER_PARAMS,
    MATCHING_ENGINE_NAME,
    parseLiquidityLayerEnvFile,
} from "../src/testing";
import { expect } from "chai";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

const CHAIN_PATHWAYS: ValidNetwork[] = ["Ethereum", "Avalanche", "Base"];

describe("Configuration", () => {
    const envPath = `${__dirname}/../../env/localnet`;

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
                    DEFAULT_FAST_TRANSFER_PARAMS.maxAmount.toString(),
                );
                expect(state.baseFee.toString()).to.equal(
                    DEFAULT_FAST_TRANSFER_PARAMS.baseFee.toString(),
                );
                expect(state.initAuctionFee.toString()).to.equal(
                    DEFAULT_FAST_TRANSFER_PARAMS.initAuctionFee.toString(),
                );
            });

            it(`Set Infinite Approval For ${chainName}`, async () => {
                await router
                    .setCctpAllowance(ethers.constants.MaxUint256)
                    .then((tx) => mineWait(provider, tx));
            });
        }
    });

    describe("Matching Engine Configuration", () => {
        it("Set Infinite Approval For Matching Engine", async () => {
            const env = parseLiquidityLayerEnvFile(`${envPath}/${MATCHING_ENGINE_NAME}.env`);
            const provider = new ethers.providers.StaticJsonRpcProvider(
                LOCALHOSTS[MATCHING_ENGINE_NAME],
            );
            const assistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, provider);

            const matchingEngineAddress = toUniversal(
                "Avalanche",
                env.matchingEngineAddress,
            ).toNative("Avalanche");
            const engine = IMatchingEngine__factory.connect(
                matchingEngineAddress.toString(),
                assistant,
            );

            await engine
                .setCctpAllowance(ethers.constants.MaxUint256)
                .then((tx) => mineWait(provider, tx));
        });
    });
});
