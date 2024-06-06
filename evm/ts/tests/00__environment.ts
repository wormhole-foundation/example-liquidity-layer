import { expect } from "chai";
import { execSync } from "child_process";
import { ethers } from "ethers";
import {
    ICircleBridge__factory,
    IMessageTransmitter__factory,
    IWormhole__factory,
} from "../src/types/factories";

import { IUSDC__factory } from "../src/types/factories/IUSDC__factory";
import {
    parseLiquidityLayerEnvFile,
    GUARDIAN_PRIVATE_KEY,
    LOCALHOSTS,
    MATCHING_ENGINE_CHAIN,
    OWNER_PRIVATE_KEY,
    ValidNetwork,
    WALLET_PRIVATE_KEYS,
    WORMHOLE_GUARDIAN_SET_INDEX,
    WORMHOLE_MESSAGE_FEE,
    mineWait,
} from "../src/helpers";

describe("Environment", () => {
    const chainNames: ValidNetwork[] = ["Avalanche", "Ethereum", "Base"];

    for (const chainName of chainNames) {
        if (!(chainName in LOCALHOSTS)) {
            throw new Error(`Missing chainName: ${chainName}`);
        }

        const envPath = `${__dirname}/../../env/localnet`;
        const {
            chainId,
            tokenAddress: usdcAddress,
            wormholeAddress,
            tokenMessengerAddress,
        } = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);

        const localhost = LOCALHOSTS[chainName] as string;

        describe(`Forked Network: ${chainName}`, () => {
            const provider = new ethers.providers.StaticJsonRpcProvider(localhost);
            const wallets = WALLET_PRIVATE_KEYS.map((key) => new ethers.Wallet(key, provider));

            const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

            it("Wallets", async () => {
                const balances = await Promise.all(wallets.map((wallet) => wallet.getBalance()));

                for (const balance of balances) {
                    expect(balance.toString()).equals("10000000000000000000000");
                }
            });

            it("Modify Core Bridge", async () => {
                const coreBridge = IWormhole__factory.connect(wormholeAddress, provider);

                const actualChainId = await coreBridge.chainId();
                expect(actualChainId).to.equal(chainId);

                // fetch current coreBridge protocol fee
                const messageFee = await coreBridge.messageFee();
                expect(messageFee.eq(WORMHOLE_MESSAGE_FEE)).to.be.true;

                // override guardian set
                {
                    // check guardian set index
                    const guardianSetIndex = await coreBridge.getCurrentGuardianSetIndex();
                    expect(guardianSetIndex).to.equal(WORMHOLE_GUARDIAN_SET_INDEX);

                    // override guardian set
                    const abiCoder = ethers.utils.defaultAbiCoder;

                    // get slot for Guardian Set at the current index
                    const guardianSetSlot = ethers.utils.keccak256(
                        abiCoder.encode(["uint32", "uint256"], [guardianSetIndex, 2]),
                    );

                    // Overwrite all but first guardian set to zero address. This isn't
                    // necessary, but just in case we inadvertently access these slots
                    // for any reason.
                    const numGuardians = await provider
                        .getStorageAt(coreBridge.address, guardianSetSlot)
                        .then((value) => ethers.BigNumber.from(value).toBigInt());
                    for (let i = 1; i < numGuardians; ++i) {
                        await provider.send("anvil_setStorageAt", [
                            coreBridge.address,
                            abiCoder.encode(
                                ["uint256"],
                                [
                                    ethers.BigNumber.from(
                                        ethers.utils.keccak256(guardianSetSlot),
                                    ).add(i),
                                ],
                            ),
                            ethers.utils.hexZeroPad("0x0", 32),
                        ]);
                    }

                    // Now overwrite the first guardian key with the devnet key specified
                    // in the function argument.
                    const devnetGuardian = new ethers.Wallet(GUARDIAN_PRIVATE_KEY).address;
                    await provider.send("anvil_setStorageAt", [
                        coreBridge.address,
                        abiCoder.encode(
                            ["uint256"],
                            [
                                ethers.BigNumber.from(ethers.utils.keccak256(guardianSetSlot)).add(
                                    0, // just explicit w/ index 0
                                ),
                            ],
                        ),
                        ethers.utils.hexZeroPad(devnetGuardian, 32),
                    ]);

                    // change the length to 1 guardian
                    await provider.send("anvil_setStorageAt", [
                        coreBridge.address,
                        guardianSetSlot,
                        ethers.utils.hexZeroPad("0x1", 32),
                    ]);

                    // Confirm guardian set override
                    const guardians = await coreBridge.getGuardianSet(guardianSetIndex).then(
                        (guardianSet: any) => guardianSet[0], // first element is array of keys
                    );
                    expect(guardians.length).to.equal(1);
                    expect(guardians[0]).to.equal(devnetGuardian);
                }
            });

            it("Modify Circle Contracts", async () => {
                const circleBridge = ICircleBridge__factory.connect(
                    tokenMessengerAddress,
                    provider,
                );

                // fetch attestation manager address
                const attesterManager = await circleBridge
                    .localMessageTransmitter()
                    .then((address) => IMessageTransmitter__factory.connect(address, provider))
                    .then((messageTransmitter) => messageTransmitter.attesterManager());
                const myAttester = new ethers.Wallet(GUARDIAN_PRIVATE_KEY, provider);

                // start prank (impersonate the attesterManager)
                await provider.send("anvil_impersonateAccount", [attesterManager]);
                await provider.send("anvil_setBalance", [
                    attesterManager,
                    ethers.BigNumber.from("1000000000000000000")._hex,
                ]);

                // instantiate message transmitter
                const messageTransmitter = await circleBridge
                    .localMessageTransmitter()
                    .then((address) =>
                        IMessageTransmitter__factory.connect(
                            address,
                            provider.getSigner(attesterManager),
                        ),
                    );
                // const existingAttester = await messageTransmitter.getEnabledAttester(0);

                // update the number of required attestations to one
                await messageTransmitter
                    .setSignatureThreshold(ethers.BigNumber.from("1"))
                    .then((tx) => mineWait(provider, tx));

                // enable devnet guardian as attester
                await messageTransmitter
                    .enableAttester(myAttester.address)
                    .then((tx) => mineWait(provider, tx));

                // stop prank
                await provider.send("anvil_stopImpersonatingAccount", [attesterManager]);

                // fetch number of attesters
                const numAttesters = await messageTransmitter.getNumEnabledAttesters();

                // confirm that the attester address swap was successful
                const attester = await circleBridge
                    .localMessageTransmitter()
                    .then((address) => IMessageTransmitter__factory.connect(address, provider))
                    .then((messageTransmitter) =>
                        messageTransmitter.getEnabledAttester(
                            numAttesters.sub(ethers.BigNumber.from("1")),
                        ),
                    );
                expect(myAttester.address).to.equal(attester);
            });

            it("Mint CCTP USDC", async () => {
                // fetch master minter address
                const masterMinter = await IUSDC__factory.connect(
                    usdcAddress,
                    provider,
                ).masterMinter();

                // start prank (impersonate the Circle masterMinter)
                await provider.send("anvil_impersonateAccount", [masterMinter]);
                await provider.send("anvil_setBalance", [
                    masterMinter,
                    ethers.BigNumber.from("1000000000000000000")._hex,
                ]);

                // configure my wallet as minter
                {
                    const usdc = IUSDC__factory.connect(
                        usdcAddress,
                        provider.getSigner(masterMinter),
                    );

                    await usdc
                        .configureMinter(owner.address, ethers.constants.MaxUint256)
                        .then((tx) => mineWait(provider, tx));
                }

                // stop prank
                await provider.send("anvil_stopImpersonatingAccount", [masterMinter]);

                // mint USDC and confirm with a balance check
                {
                    const usdc = IUSDC__factory.connect(usdcAddress, owner);
                    const amount = ethers.utils.parseUnits("69420", 6);

                    const balanceBefore = await usdc.balanceOf(owner.address);

                    await usdc.mint(owner.address, amount).then((tx) => mineWait(provider, tx));

                    const balanceAfter = await usdc.balanceOf(owner.address);
                    expect(balanceAfter.sub(balanceBefore).eq(amount)).is.true;

                    await usdc
                        .transfer("0x0000000000000000000000000000000000000001", balanceAfter)
                        .then((tx) => mineWait(provider, tx));
                }
            });

            if (chainId === MATCHING_ENGINE_CHAIN) {
                it("Deploy Matching Engine", async () => {
                    await provider.send("evm_setAutomine", [true]);

                    const scripts = `${__dirname}/../../sh`;
                    const cmd =
                        `bash ${scripts}/deploy_matching_engine.sh ` +
                        `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey} ` +
                        `> /dev/null 2>&1`;
                    const out = execSync(cmd, { encoding: "utf8" });

                    await provider.send("evm_setAutomine", [false]);
                });

                it("Upgrade Matching Engine", async () => {
                    await provider.send("evm_setAutomine", [true]);

                    const scripts = `${__dirname}/../../sh`;
                    const cmd =
                        `bash ${scripts}/upgrade_matching_engine.sh ` +
                        `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey}` +
                        `> /dev/null 2>&1`;
                    const out = execSync(cmd, { encoding: "utf8" });
                    await provider.send("evm_setAutomine", [false]);
                });
            }

            it("Deploy Token Router", async () => {
                await provider.send("evm_setAutomine", [true]);

                const scripts = `${__dirname}/../../sh`;
                const cmd =
                    `bash ${scripts}/deploy_token_router.sh ` +
                    `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey} ` +
                    `> /dev/null 2>&1`;
                const out = execSync(cmd, { encoding: "utf8" });

                await provider.send("evm_setAutomine", [false]);
            });

            it("Upgrade Token Router", async () => {
                await provider.send("evm_setAutomine", [true]);

                const scripts = `${__dirname}/../../sh`;
                const cmd =
                    `bash ${scripts}/upgrade_token_router.sh ` +
                    `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey}` +
                    `> /dev/null 2>&1`;
                const out = execSync(cmd, { encoding: "utf8" });
                await provider.send("evm_setAutomine", [false]);
            });
        });
    }
});
