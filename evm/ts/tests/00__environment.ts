import { tryUint8ArrayToNative } from "@certusone/wormhole-sdk";
import {
  IERC165__factory,
  TokenImplementation__factory,
} from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { expect } from "chai";
import { execSync } from "child_process";
import { ethers } from "ethers";
import { parseLiquidityLayerEnvFile } from "../src";
import {
  ICircleBridge__factory,
  ICircleIntegration__factory,
  ICurveFactory__factory,
  ICurvePool__factory,
  IERC20__factory,
  IMatchingEngine__factory,
  IMessageTransmitter__factory,
  IOrderRouter__factory,
  ITokenBridge__factory,
  IUSDC__factory,
  IWormhole__factory,
} from "../src/types";
import {
  BSC_USDC_ADDRESS,
  CURVE_FACTORY_ADDRESS,
  ETHEREUM_USDC_ADDRESS,
  GUARDIAN_PRIVATE_KEY,
  LOCALHOSTS,
  MATCHING_ENGINE_POOL_COINS,
  OWNER_PRIVATE_KEY,
  POLYGON_USDC_ADDRESS,
  TOKEN_TYPES,
  USDC_DECIMALS,
  ValidNetworks,
  WALLET_PRIVATE_KEYS,
  WORMHOLE_GUARDIAN_SET_INDEX,
  WORMHOLE_MESSAGE_FEE,
  mineWait,
  mintNativeUsdc,
  mintWrappedTokens,
} from "./helpers";

describe("Environment", () => {
  const chainNames: ValidNetworks[] = [
    "avalanche",
    "ethereum",
    "bsc",
    "moonbeam",
  ];

  for (const chainName of chainNames) {
    //for (const chainName of ["avalanche"]) {
    if (!(chainName in LOCALHOSTS)) {
      throw new Error(`Missing chainName: ${chainName}`);
    }

    const envPath = `${__dirname}/../../env/localnet`;
    const {
      chainId,
      tokenAddress: usdcAddress,
      tokenBridgeAddress,
      wormholeCctpAddress,
      orderRouterAddress,
      matchingEngineEndpoint,
      matchingPoolAddress,
    } = parseLiquidityLayerEnvFile(`${envPath}/${chainName}.env`);

    const localhost = LOCALHOSTS[chainName] as string;
    // const usdcDecimals = USDC_DECIMALS[chainName];

    const tokenType = TOKEN_TYPES[chainName] as number;

    describe(`Forked Network: ${chainName}`, () => {
      const provider = new ethers.providers.StaticJsonRpcProvider(localhost);
      const wallets = WALLET_PRIVATE_KEYS.map(
        (key) => new ethers.Wallet(key, provider)
      );

      const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

      const tokenBridge = ITokenBridge__factory.connect(
        tokenBridgeAddress,
        provider
      );

      const wormholeCctp =
        wormholeCctpAddress === ethers.constants.AddressZero
          ? null
          : ICircleIntegration__factory.connect(wormholeCctpAddress, provider);

      // const orderRouterJson = `${__dirname}/../../out/OrderRouter.sol/OrderRouter.json`;
      // if (!fs.existsSync(orderRouterJson)) {
      //   throw new Error(`Missing OrderRouter.json: ${orderRouterJson}`);
      // }

      // const { abi: orderRouterAbi, bytecode: orderRouterBytecode } = JSON.parse(
      //   fs.readFileSync(orderRouterJson, "utf8")
      // );

      it("Wallets", async () => {
        const balances = await Promise.all(
          wallets.map((wallet) => wallet.getBalance())
        );

        for (const balance of balances) {
          expect(balance.toString()).equals("10000000000000000000000");
        }
      }); // it("Wallets", async () => {

      it("Modify Core Bridge", async () => {
        const coreBridge = IWormhole__factory.connect(
          await tokenBridge.wormhole(),
          provider
        );

        const actualChainId = await coreBridge.chainId();
        expect(actualChainId).to.equal(chainId);

        // fetch current coreBridge protocol fee
        const messageFee = await coreBridge.messageFee();
        expect(messageFee.eq(WORMHOLE_MESSAGE_FEE)).to.be.true;

        // override guardian set
        {
          // check guardian set index
          const guardianSetIndex =
            await coreBridge.getCurrentGuardianSetIndex();
          expect(guardianSetIndex).to.equal(WORMHOLE_GUARDIAN_SET_INDEX);

          // override guardian set
          const abiCoder = ethers.utils.defaultAbiCoder;

          // get slot for Guardian Set at the current index
          const guardianSetSlot = ethers.utils.keccak256(
            abiCoder.encode(["uint32", "uint256"], [guardianSetIndex, 2])
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
                    ethers.utils.keccak256(guardianSetSlot)
                  ).add(i),
                ]
              ),
              ethers.utils.hexZeroPad("0x0", 32),
            ]);
          }

          // Now overwrite the first guardian key with the devnet key specified
          // in the function argument.
          const devnetGuardian = new ethers.Wallet(GUARDIAN_PRIVATE_KEY)
            .address;
          await provider.send("anvil_setStorageAt", [
            coreBridge.address,
            abiCoder.encode(
              ["uint256"],
              [
                ethers.BigNumber.from(
                  ethers.utils.keccak256(guardianSetSlot)
                ).add(
                  0 // just explicit w/ index 0
                ),
              ]
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
          const guardians = await coreBridge
            .getGuardianSet(guardianSetIndex)
            .then(
              (guardianSet: any) => guardianSet[0] // first element is array of keys
            );
          expect(guardians.length).to.equal(1);
          expect(guardians[0]).to.equal(devnetGuardian);
        }
      }); // it("Modify Core Bridge", async () => {

      it.skip("Modify Token Bridge", async () => {
        // TODO
      });

      if (wormholeCctp !== null) {
        it("Modify Circle Contracts", async () => {
          const circleBridge = ICircleBridge__factory.connect(
            await wormholeCctp.circleBridge(),
            provider
          );

          // fetch attestation manager address
          const attesterManager = await circleBridge
            .localMessageTransmitter()
            .then((address) =>
              IMessageTransmitter__factory.connect(address, provider)
            )
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
                provider.getSigner(attesterManager)
              )
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
          await provider.send("anvil_stopImpersonatingAccount", [
            attesterManager,
          ]);

          // fetch number of attesters
          const numAttesters =
            await messageTransmitter.getNumEnabledAttesters();

          // confirm that the attester address swap was successful
          const attester = await circleBridge
            .localMessageTransmitter()
            .then((address) =>
              IMessageTransmitter__factory.connect(address, provider)
            )
            .then((messageTransmitter) =>
              messageTransmitter.getEnabledAttester(
                numAttesters.sub(ethers.BigNumber.from("1"))
              )
            );
          expect(myAttester.address).to.equal(attester);
        }); // it("Modify Circle Contracts", async () => {

        it("Mint CCTP USDC", async () => {
          // fetch master minter address
          const masterMinter = await IUSDC__factory.connect(
            usdcAddress,
            provider
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
              provider.getSigner(masterMinter)
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

            await usdc
              .mint(owner.address, amount)
              .then((tx) => mineWait(provider, tx));

            const balanceAfter = await usdc.balanceOf(owner.address);
            expect(balanceAfter.sub(balanceBefore).eq(amount)).is.true;

            await usdc
              .transfer("0x0000000000000000000000000000000000000001", amount)
              .then((tx) => mineWait(provider, tx));
          }
        }); // it("CCTP USDC", async () => {
      } // if (wormholeCctp !== null) {

      if (chainName === "avalanche") {
        it("Deploy Curve Pool", async () => {
          const curveFactory = ICurveFactory__factory.connect(
            CURVE_FACTORY_ADDRESS,
            owner
          );

          const receipt = await curveFactory
            .deploy_plain_pool(
              "USDC Matching Pool",
              "meUSDC",
              MATCHING_ENGINE_POOL_COINS,
              100, // A
              4_000_000, // fee (0.04%)
              0, // asset type
              0 // implementation index
            )
            .then((tx) => mineWait(provider, tx));

          const matchingPoolAddress = ethers.utils.hexlify(
            ethers.utils.arrayify(receipt.logs[1].topics[2]).subarray(12)
          );
          const curvePool = ICurvePool__factory.connect(
            matchingPoolAddress,
            owner
          );

          for (let i = 0; i < 4; ++i) {
            const actual = await curvePool.coins(i);
            expect(actual).to.equal(MATCHING_ENGINE_POOL_COINS[i]);
          }

          // Prep to add liquidity.
          const legAmount = "1000000";

          const avaxUsdcDecimals = USDC_DECIMALS.avalanche!;
          const avaxUsdcAmount = ethers.utils.parseUnits(
            legAmount,
            avaxUsdcDecimals
          );
          const avaxUsdc = IERC20__factory.connect(usdcAddress, owner);
          await mintNativeUsdc(avaxUsdc, owner.address, avaxUsdcAmount);

          {
            const decimals = await IUSDC__factory.connect(
              avaxUsdc.address,
              provider
            ).decimals();
            expect(decimals).to.equal(avaxUsdcDecimals);

            const balance = await avaxUsdc.balanceOf(owner.address);
            expect(balance).to.eql(avaxUsdcAmount);
          }

          const ethUsdcDecimals = USDC_DECIMALS.ethereum!;
          const ethUsdcAmount = ethers.utils.parseUnits(
            legAmount,
            ethUsdcDecimals
          );
          const { wrappedToken: ethUsdc } = await mintWrappedTokens(
            owner,
            tokenBridgeAddress,
            "ethereum",
            ETHEREUM_USDC_ADDRESS,
            owner.address,
            ethUsdcAmount
          );

          {
            const decimals = await TokenImplementation__factory.connect(
              ethUsdc.address,
              provider
            ).decimals();
            expect(decimals).to.equal(ethUsdcDecimals);

            const balance = await ethUsdc.balanceOf(owner.address);
            expect(balance).to.eql(ethUsdcAmount);
          }

          const polyUsdcAmount = ethers.utils.parseUnits(legAmount, 6);
          const { wrappedToken: polyUsdc } = await mintWrappedTokens(
            owner,
            tokenBridgeAddress,
            "polygon",
            POLYGON_USDC_ADDRESS,
            owner.address,
            polyUsdcAmount
          );

          {
            const decimals = await new ethers.Contract(
              polyUsdc.address,
              ["function decimals() external view returns (uint8)"],
              provider
            ).decimals();
            expect(decimals).to.equal(6);

            const balance = await polyUsdc.balanceOf(owner.address);
            expect(balance).to.eql(polyUsdcAmount);
          }

          const bscUsdcDecimals = USDC_DECIMALS.bsc!;
          const bscUsdcAmount = ethers.utils.parseUnits(
            legAmount,
            bscUsdcDecimals
          );
          const { wrappedToken: bscUsdc } = await mintWrappedTokens(
            owner,
            tokenBridgeAddress,
            "bsc",
            BSC_USDC_ADDRESS,
            owner.address,
            bscUsdcAmount
          );

          {
            const decimals = await TokenImplementation__factory.connect(
              bscUsdc.address,
              provider
            ).decimals();
            expect(decimals).to.equal(bscUsdcDecimals);

            const balance = await bscUsdc.balanceOf(owner.address);
            expect(balance).to.eql(bscUsdcAmount);
          }

          // Now add liquidity.
          await avaxUsdc
            .approve(curvePool.address, avaxUsdcAmount)
            .then((tx) => mineWait(provider, tx));
          await ethUsdc
            .approve(curvePool.address, ethUsdcAmount)
            .then((tx) => mineWait(provider, tx));
          await polyUsdc
            .approve(curvePool.address, polyUsdcAmount)
            .then((tx) => mineWait(provider, tx));
          await bscUsdc
            .approve(curvePool.address, bscUsdcAmount)
            .then((tx) => mineWait(provider, tx));

          await curvePool["add_liquidity(uint256[4],uint256)"](
            [avaxUsdcAmount, ethUsdcAmount, polyUsdcAmount, bscUsdcAmount],
            0
          ).then((tx) => mineWait(provider, tx));

          const avaxUsdcLiqBalance = await curvePool.balances(0);
          expect(avaxUsdcLiqBalance).to.eql(avaxUsdcAmount);

          const ethUsdcLiqBalance = await curvePool.balances(1);
          expect(ethUsdcLiqBalance).to.eql(ethUsdcAmount);

          const polyUsdcLiqBalance = await curvePool.balances(2);
          expect(polyUsdcLiqBalance).to.eql(polyUsdcAmount);

          const bscUsdcLiqBalance = await curvePool.balances(3);
          expect(bscUsdcLiqBalance).to.eql(bscUsdcAmount);
        });

        it("Deploy Matching Engine", async () => {
          await provider.send("evm_setAutomine", [true]);

          const scripts = `${__dirname}/../../sh`;
          const cmd =
            `bash ${scripts}/deploy_matching_engine.sh ` +
            `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey}` +
            `> /dev/null 2>&1`;
          const out = execSync(cmd, { encoding: "utf8" });

          await provider.send("evm_setAutomine", [false]);

          const matchingEngine = IMatchingEngine__factory.connect(
            tryUint8ArrayToNative(
              ethers.utils.arrayify(matchingEngineEndpoint),
              "avalanche"
            ),
            provider
          );
          const { pool: poolInfoAddress } =
            await matchingEngine.getCurvePoolInfo();
          expect(poolInfoAddress).to.equal(matchingPoolAddress!);
        }); // it("Deploy Matching Engine", async () => {

        it("Upgrade Matching Engine", async () => {
          await provider.send("evm_setAutomine", [true]);

          const scripts = `${__dirname}/../../sh`;
          const cmd =
            `bash ${scripts}/upgrade_matching_engine.sh ` +
            `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey}` +
            `> /dev/null 2>&1`;
          const out = execSync(cmd, { encoding: "utf8" });

          await provider.send("evm_setAutomine", [false]);
        }); // it("Upgrade Matching Engine", async () => {
      } // if (chainName === "avalanche") {

      it("Deploy Order Router", async () => {
        await provider.send("evm_setAutomine", [true]);

        const scripts = `${__dirname}/../../sh`;
        const cmd =
          `bash ${scripts}/deploy_order_router.sh ` +
          `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey} ` +
          `> /dev/null 2>&1`;
        const out = execSync(cmd, { encoding: "utf8" });

        await provider.send("evm_setAutomine", [false]);

        const orderRouter = IOrderRouter__factory.connect(
          orderRouterAddress,
          provider
        );
        const maxAmount = await orderRouter.MAX_AMOUNT();
        expect(maxAmount.toString()).equals(
          "115792089237316195423570985008687907853269984665640564039457584007913129"
        );
        const actualTokenType = await orderRouter.tokenType();
        expect(actualTokenType).to.equal(tokenType);
      }); // it("Deploy Order Router", async () => {

      it("Upgrade Order Router", async () => {
        await provider.send("evm_setAutomine", [true]);

        const scripts = `${__dirname}/../../sh`;
        const cmd =
          `bash ${scripts}/upgrade_order_router.sh ` +
          `-n localnet -c ${chainName} -u ${localhost} -k ${owner.privateKey}` +
          `> /dev/null 2>&1`;
        const out = execSync(cmd, { encoding: "utf8" });

        await provider.send("evm_setAutomine", [false]);
      }); // it("Upgrade Order Router", async () => {
    });
  } // for (const chainName of ["arbitrum", "avalanche", "ethereum", "polygon"]) {
});
