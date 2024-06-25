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
} from "../src/testing";
import { encoding } from "@wormhole-foundation/sdk-base";
import { EvmAddress } from "@wormhole-foundation/sdk-evm";

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
            const provider = new ethers.JsonRpcProvider(localhost);
            const wallets = WALLET_PRIVATE_KEYS.map((key) => new ethers.Wallet(key, provider));

            const owner = new ethers.NonceManager(new ethers.Wallet(OWNER_PRIVATE_KEY, provider));

            it("Wallets", async () => {
                const balances = await Promise.all(
                    wallets.map((wallet) => wallet.provider?.getBalance(wallet.address)),
                );

                for (const balance of balances) {
                    expect(balance!.toString()).equals("10000000000000000000000");
                }
            });

            it("Modify Core Bridge", async () => {
                const coreBridge = IWormhole__factory.connect(wormholeAddress, provider);

                const actualChainId = Number(await coreBridge.chainId());
                expect(actualChainId).to.equal(chainId);

                // fetch current coreBridge protocol fee
                const messageFee = Number(await coreBridge.messageFee());
                expect(messageFee).to.equal(WORMHOLE_MESSAGE_FEE);

                // override guardian set
                {
                    // check guardian set index
                    const guardianSetIndex = Number(await coreBridge.getCurrentGuardianSetIndex());
                    expect(guardianSetIndex).to.equal(WORMHOLE_GUARDIAN_SET_INDEX);

                    // override guardian set
                    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

                    // get slot for Guardian Set at the current index
                    const guardianSetSlot = ethers.keccak256(
                        abiCoder.encode(["uint32", "uint256"], [guardianSetIndex, 2]),
                    );

                    const coreAddress = await coreBridge.getAddress();
                    // Overwrite all but first guardian set to zero address. This isn't
                    // necessary, but just in case we inadvertently access these slots
                    // for any reason.
                    const numGuardians = await provider
                        .getStorage(coreAddress, guardianSetSlot)
                        .then((value) => BigInt(value));

                    for (let i = 1; i < numGuardians; ++i) {
                        await provider.send("anvil_setStorageAt", [
                            coreAddress,
                            abiCoder.encode(
                                ["uint256"],
                                [
                                    encoding.bignum.decode(ethers.keccak256(guardianSetSlot)) +
                                        BigInt(i),
                                ],
                            ),
                            encoding.hex.encode(encoding.bignum.toBytes(0n, 32), true),
                        ]);
                    }

                    // Now overwrite the first guardian key with the devnet key specified
                    // in the function argument.
                    const devnetGuardian = new ethers.Wallet(GUARDIAN_PRIVATE_KEY).address;
                    await provider.send("anvil_setStorageAt", [
                        coreAddress,
                        abiCoder.encode(
                            ["uint256"],
                            [
                                encoding.bignum.decode(ethers.keccak256(guardianSetSlot)) + 0n, // just explicit w/ index 0
                            ],
                        ),
                        new EvmAddress(devnetGuardian).toUniversalAddress().toString(),
                    ]);

                    // change the length to 1 guardian
                    await provider.send("anvil_setStorageAt", [
                        coreAddress,
                        guardianSetSlot,
                        encoding.hex.encode(encoding.bignum.toBytes(1n, 32), true),
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
                    encoding.hex.encode(encoding.bignum.toBytes(1000000000000000000n), true),
                ]);

                const attesterSigner = await provider.getSigner(attesterManager);
                // instantiate message transmitter
                const messageTransmitter = await circleBridge
                    .localMessageTransmitter()
                    .then((address) =>
                        IMessageTransmitter__factory.connect(address, attesterSigner),
                    );
                // const existingAttester = await messageTransmitter.getEnabledAttester(0);

                // update the number of required attestations to one
                await messageTransmitter
                    .setSignatureThreshold(1n)
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
                        messageTransmitter.getEnabledAttester(numAttesters - 1n),
                    );
                expect(myAttester.address).to.equal(attester);
            });

            it("Mint CCTP USDC", async () => {
                const ownerAddress = await owner.getAddress();
                // fetch master minter address
                const masterMinter = await IUSDC__factory.connect(
                    usdcAddress,
                    provider,
                ).masterMinter();

                // start prank (impersonate the Circle masterMinter)
                await provider.send("anvil_impersonateAccount", [masterMinter]);
                await provider.send("anvil_setBalance", [
                    masterMinter,
                    encoding.hex.encode(encoding.bignum.encode(1000000000000000000n), true),
                ]);

                // configure my wallet as minter
                {
                    const usdc = IUSDC__factory.connect(
                        usdcAddress,
                        await provider.getSigner(masterMinter),
                    );

                    await usdc
                        .configureMinter(ownerAddress, ethers.MaxUint256)
                        .then((tx) => mineWait(provider, tx));
                }

                // stop prank
                await provider.send("anvil_stopImpersonatingAccount", [masterMinter]);

                // mint USDC and confirm with a balance check
                {
                    const usdc = IUSDC__factory.connect(usdcAddress, owner);
                    const amount = ethers.parseUnits("69420", 6);

                    const balanceBefore = await usdc.balanceOf(ownerAddress);

                    await usdc.mint(ownerAddress, amount).then((tx) => mineWait(provider, tx));

                    const balanceAfter = await usdc.balanceOf(ownerAddress);
                    expect(balanceAfter - balanceBefore).to.eq(amount);

                    await usdc.transfer
                        .populateTransaction(
                            "0x0000000000000000000000000000000000000001",
                            balanceAfter,
                        )
                        .then(async (txreq) => {
                            txreq.nonce = await owner.getNonce();
                            return await owner.signer.sendTransaction(txreq);
                        })
                        .then((tx) => mineWait(provider, tx));
                }
            });

            if (chainId === MATCHING_ENGINE_CHAIN) {
                it("Deploy Matching Engine", async () => {
                    await provider.send("evm_setAutomine", [true]);

                    const scripts = `${__dirname}/../../sh`;
                    const cmd =
                        `bash ${scripts}/deploy_matching_engine.sh ` +
                        `-n localnet -c ${chainName} -u ${localhost} -k ${
                            (owner.signer as ethers.Wallet).privateKey
                        } ` +
                        `> /dev/null 2>&1`;
                    const out = execSync(cmd, { encoding: "utf8" });

                    await provider.send("evm_setAutomine", [false]);
                });

                it("Upgrade Matching Engine", async () => {
                    await provider.send("evm_setAutomine", [true]);

                    const scripts = `${__dirname}/../../sh`;
                    const cmd =
                        `bash ${scripts}/upgrade_matching_engine.sh ` +
                        `-n localnet -c ${chainName} -u ${localhost} -k ${OWNER_PRIVATE_KEY}` +
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
                    `-n localnet -c ${chainName} -u ${localhost} -k ${OWNER_PRIVATE_KEY} ` +
                    `> /dev/null 2>&1`;
                const out = execSync(cmd, { encoding: "utf8" });

                await provider.send("evm_setAutomine", [false]);
            });

            it("Upgrade Token Router", async () => {
                await provider.send("evm_setAutomine", [true]);

                const scripts = `${__dirname}/../../sh`;
                const cmd =
                    `bash ${scripts}/upgrade_token_router.sh ` +
                    `-n localnet -c ${chainName} -u ${localhost} -k ${OWNER_PRIVATE_KEY}` +
                    `> /dev/null 2>&1`;
                const out = execSync(cmd, { encoding: "utf8" });
                await provider.send("evm_setAutomine", [false]);
            });
        });
    }
});
