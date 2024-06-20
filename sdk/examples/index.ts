import { Connection } from "@solana/web3.js";
import { localnet } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { SolanaMatchingEngine } from "@wormhole-foundation/example-liquidity-layer-solana/protocol";
import {
    LOCALHOST,
    USDC_MINT_ADDRESS,
} from "@wormhole-foundation/example-liquidity-layer-solana/testing";

(async function () {
    const connection = new Connection(LOCALHOST, "processed");
    const matcher = new SolanaMatchingEngine("Devnet", "Solana", connection, {
        matchingEngine: localnet(),
        usdcMint: USDC_MINT_ADDRESS.toBase58(),
    });
    console.log(matcher);
})();
