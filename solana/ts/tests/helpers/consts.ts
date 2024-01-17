import { PublicKey, Keypair } from "@solana/web3.js";
import { CONTRACTS } from "@certusone/wormhole-sdk";
import { MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";

export const SWAP_RATE_PRECISION = 10 ** 8;

export const MAX_BPS_FEE = 1_000_000;

export const WORMHOLE_CONTRACTS = CONTRACTS.TESTNET;
export const CORE_BRIDGE_PID = new PublicKey(WORMHOLE_CONTRACTS.solana.core);

export const TOKEN_ROUTER_PID = new PublicKey("TokenRouter11111111111111111111111111111111");

export const LOCALHOST = "http://localhost:8899";

export const PAYER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "cDfpY+VbRFXPPwouZwAx+ha9HqedkhqUr5vUaFa2ucAMGliG/hCT35/EOMKW+fcnW3cYtrwOFW2NM2xY8IOZbQ==",
        "base64"
    )
);

export const OWNER_ASSISTANT_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "900mlHo1RRdhxUKuBnnPowQ7yqb4rJ1dC7K1PM+pRxeuCWamoSkQdY+3hXAeX0OBXanyqg4oyBl8g1z1sDnSWg==",
        "base64"
    )
);

export const GOVERNANCE_EMITTER_ADDRESS = new PublicKey("11111111111111111111111111111115");

export const GUARDIAN_KEY = "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const MOCK_GUARDIANS = new MockGuardians(0, [GUARDIAN_KEY]);

export const USDC_MINT_ADDRESS = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export const ETHEREUM_USDC_ADDRESS = "0x07865c6e87b9f70255377e024ace6630c1eaa37f";
