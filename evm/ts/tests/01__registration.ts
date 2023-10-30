import { coalesceChainId, tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import { ethers } from "ethers";
import { ITokenRouter__factory } from "../src/types";
import { LOCALHOSTS, OWNER_ASSISTANT_PRIVATE_KEY, mineWait } from "./helpers";
import { expect } from "chai";

import { parseLiquidityLayerEnvFile } from "../src";

describe("Registration", () => {
    const envPath = `${__dirname}/../../env/localnet`;

    // Avax.
    const avaxEnv = parseLiquidityLayerEnvFile(`${envPath}/avalanche.env`);
    const avaxProvider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS.avalanche);
    const avaxAssistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, avaxProvider);
    const avaxRouter = ITokenRouter__factory.connect(avaxEnv.tokenRouterAddress, avaxAssistant);

    // Ethereum.
    const ethEnv = parseLiquidityLayerEnvFile(`${envPath}/ethereum.env`);
    const ethProvider = new ethers.providers.StaticJsonRpcProvider(LOCALHOSTS.ethereum);
    const ethAssistant = new ethers.Wallet(OWNER_ASSISTANT_PRIVATE_KEY, ethProvider);
    const ethRouter = ITokenRouter__factory.connect(ethEnv.tokenRouterAddress, ethAssistant);

    it(`Register Ethereum Order Route On Avalanche`, async () => {
        const formattedAddress = tryNativeToUint8Array(ethEnv.tokenRouterAddress, "ethereum");
        const targetChain = coalesceChainId("ethereum");
        await avaxRouter
            .addRouterEndpoint(targetChain, formattedAddress)
            .then((tx) => mineWait(avaxProvider, tx));

        const registeredAddress = await avaxRouter.getRouter(targetChain);
        expect(registeredAddress.substring(2)).to.equal(
            Buffer.from(formattedAddress).toString("hex")
        );
    });

    it(`Register Avalanche Order Route On Ethereum`, async () => {
        const formattedAddress = tryNativeToUint8Array(avaxEnv.tokenRouterAddress, "avalanche");
        const targetChain = coalesceChainId("avalanche");
        await ethRouter
            .addRouterEndpoint(targetChain, formattedAddress)
            .then((tx) => mineWait(ethProvider, tx));

        const registeredAddress = await ethRouter.getRouter(targetChain);
        expect(registeredAddress.substring(2)).to.equal(
            Buffer.from(formattedAddress).toString("hex")
        );
    });
});
