import { PublicKey, Keypair } from "@solana/web3.js";
import { CONTRACTS } from "@certusone/wormhole-sdk";
import { MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";

export const SWAP_RATE_PRECISION = 10 ** 8;

export const WORMHOLE_CONTRACTS = CONTRACTS.MAINNET;
export const CORE_BRIDGE_PID = new PublicKey(WORMHOLE_CONTRACTS.solana.core);

export const TOKEN_ROUTER_PID = new PublicKey("TokenRouter11111111111111111111111111111111");

export const LOCALHOST = "http://localhost:8899";

export const PAYER_KEYPAIR = Keypair.fromSecretKey(
    Buffer.from(
        "7037e963e55b4455cf3f0a2e670031fa16bd1ea79d921a94af9bd46856b6b9c00c1a5886fe1093df9fc438c296f9f7275b7718b6bc0e156d8d336c58f083996d",
        "hex"
    )
);

export const GOVERNANCE_EMITTER_ADDRESS = new PublicKey("11111111111111111111111111111115");

export const MOCK_GUARDIANS = new MockGuardians(0, [
    "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0",
]);

export const USDC_MINT_ADDRESS = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
