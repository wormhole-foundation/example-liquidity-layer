import { Keypair, PublicKey } from "@solana/web3.js";
import { TokenRouter } from "@wormhole-foundation/example-liquidity-layer-definitions";
import { Chain, Network, circle, encoding } from "@wormhole-foundation/sdk-base";
import { UniversalAddress } from "@wormhole-foundation/sdk-definitions";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";

export const LOCALHOST = "http://localhost:8899";

export const PAYER_KEYPAIR = Keypair.fromSecretKey(
    encoding.b64.decode(
        "cDfpY+VbRFXPPwouZwAx+ha9HqedkhqUr5vUaFa2ucAMGliG/hCT35/EOMKW+fcnW3cYtrwOFW2NM2xY8IOZbQ==",
    ),
);
export const OWNER_ASSISTANT_KEYPAIR = Keypair.fromSecretKey(
    encoding.b64.decode(
        "900mlHo1RRdhxUKuBnnPowQ7yqb4rJ1dC7K1PM+pRxeuCWamoSkQdY+3hXAeX0OBXanyqg4oyBl8g1z1sDnSWg==",
    ),
);
export const OWNER_KEYPAIR = Keypair.fromSecretKey(
    encoding.b64.decode(
        "t0zuiHtsaDJBSUFzkvXNttgXOMvZy0bbuUPGEByIJEHAUdFeBdSAesMbgbuH1v/y+B8CdTSkCIZZNuCntHQ+Ig==",
    ),
);
export const PLAYER_ONE_KEYPAIR = Keypair.fromSecretKey(
    encoding.b64.decode(
        "4STrqllKVVva0Fphqyf++6uGTVReATBe2cI26oIuVBft77CQP9qQrMTU1nM9ql0EnCpSgmCmm20m8khMo9WdPQ==",
    ),
);

export const GUARDIAN_KEY = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const MOCK_GUARDIANS = new mocks.MockGuardians(0, [GUARDIAN_KEY]);

export const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

//export const ETHEREUM_USDC_ADDRESS = "0x07865c6e87b9f70255377e024ace6630c1eaa37f";
export const ETHEREUM_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const toDomain = (chain: Chain) => circle.toCircleChainId("Mainnet", chain);
export const CHAIN_TO_DOMAIN: { [k in Chain]?: number } = {
    Ethereum: toDomain("Ethereum"),
    Avalanche: toDomain("Avalanche"),
    Optimism: toDomain("Optimism"),
    Arbitrum: toDomain("Arbitrum"),
    // noble: toDomain("noble"),
    Solana: toDomain("Solana"),
    Base: toDomain("Base"),
    Polygon: toDomain("Polygon"),
};

export const REGISTERED_TOKEN_ROUTERS: { [k in Chain]?: Array<number> } = {
    Ethereum: Array.from(Buffer.alloc(32, "f0", "hex")),
    Avalanche: Array.from(Buffer.alloc(32, "f1", "hex")),
    Optimism: Array.from(Buffer.alloc(32, "f2", "hex")),
    Arbitrum: Array.from(Buffer.alloc(32, "f3", "hex")),
    Base: Array.from(Buffer.alloc(32, "f6", "hex")),
    Polygon: Array.from(Buffer.alloc(32, "f7", "hex")),
};

export const REGISTERED_TOKEN_ROUTERS_V2: { [k in Chain]?: UniversalAddress } = Object.fromEntries(
    Object.entries(REGISTERED_TOKEN_ROUTERS).map(([k, v]) => [
        k,
        new UniversalAddress(new Uint8Array(v)),
    ]),
);

export const DEFAULT_ADDRESSES: {
    [network in Network]?: TokenRouter.Addresses;
} = {
    // This is local development network, not Solana's 'devnet'
    Devnet: {
        coreBridge: "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
        matchingEngine: "MatchingEngine11111111111111111111111111111",
        tokenRouter: "TokenRouter11111111111111111111111111111111",
        cctp: {
            usdcMint: USDC_MINT_ADDRESS.toBase58(),
            tokenMessenger: "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3",
            messageTransmitter: "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
            wormhole: "",
            wormholeRelayer: "",
        },
        upgradeManager: "UpgradeManager11111111111111111111111111111",
    },
    Testnet: {
        coreBridge: "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
        matchingEngine: "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS",
        tokenRouter: "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md",
        cctp: {
            usdcMint: USDC_MINT_ADDRESS.toBase58(),
            tokenMessenger: "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3",
            messageTransmitter: "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
            wormhole: "",
            wormholeRelayer: "",
        },
        upgradeManager: "ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt",
    },
};
