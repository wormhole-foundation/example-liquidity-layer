import { PublicKey, Keypair } from "@solana/web3.js";
import { Chain, contracts } from "@wormhole-foundation/sdk-base";
import { mocks } from "@wormhole-foundation/sdk-definitions/testing";

export const CORE_BRIDGE_PID = new PublicKey(contracts.coreBridge.get("Mainnet", "Solana")!);

export const TOKEN_ROUTER_PID = new PublicKey("tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md");

export const LOCALHOST = "http://localhost:8899";

export const PAYER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "cDfpY+VbRFXPPwouZwAx+ha9HqedkhqUr5vUaFa2ucAMGliG/hCT35/EOMKW+fcnW3cYtrwOFW2NM2xY8IOZbQ==",
        "base64",
    ),
);

export const OWNER_ASSISTANT_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "900mlHo1RRdhxUKuBnnPowQ7yqb4rJ1dC7K1PM+pRxeuCWamoSkQdY+3hXAeX0OBXanyqg4oyBl8g1z1sDnSWg==",
        "base64",
    ),
);

export const OWNER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "t0zuiHtsaDJBSUFzkvXNttgXOMvZy0bbuUPGEByIJEHAUdFeBdSAesMbgbuH1v/y+B8CdTSkCIZZNuCntHQ+Ig==",
        "base64",
    ),
);

export const PLAYER_ONE_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "4STrqllKVVva0Fphqyf++6uGTVReATBe2cI26oIuVBft77CQP9qQrMTU1nM9ql0EnCpSgmCmm20m8khMo9WdPQ==",
        "base64",
    ),
);

export const GOVERNANCE_EMITTER_ADDRESS = new PublicKey("11111111111111111111111111111115");

export const GUARDIAN_KEY = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const MOCK_GUARDIANS = new mocks.MockGuardians(0, [GUARDIAN_KEY]);

export const USDC_MINT_ADDRESS = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

//export const ETHEREUM_USDC_ADDRESS = "0x07865c6e87b9f70255377e024ace6630c1eaa37f";
export const ETHEREUM_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

export const CHAIN_TO_DOMAIN: { [k in Chain]?: number } = {
    Ethereum: 0,
    Avalanche: 1,
    Optimism: 2,
    Arbitrum: 3,
    // noble: 4,
    Solana: 5,
    Base: 6,
    Polygon: 7,
};

export const REGISTERED_TOKEN_ROUTERS: { [k in Chain]?: Array<number> } = {
    Ethereum: Array.from(Buffer.alloc(32, "f0", "hex")),
    Avalanche: Array.from(Buffer.alloc(32, "f1", "hex")),
    Optimism: Array.from(Buffer.alloc(32, "f2", "hex")),
    Arbitrum: Array.from(Buffer.alloc(32, "f3", "hex")),
    Base: Array.from(Buffer.alloc(32, "f6", "hex")),
    Polygon: Array.from(Buffer.alloc(32, "f7", "hex")),
};
