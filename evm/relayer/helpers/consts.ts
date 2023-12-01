import { Wallet } from "ethers";
import { getRpc } from "./utils";
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_AVAX } from "@certusone/wormhole-sdk";

export const PK = process.env.ETH_KEY!;
export const SIGNERS = {
    [CHAIN_ID_ETH]: new Wallet(PK, getRpc(process.env.ETH_RPC!)),
    [CHAIN_ID_AVAX]: new Wallet(PK, getRpc(process.env.AVAX_RPC!)),
};
export const SUPPORTED_CHAINS: ChainId[] = [CHAIN_ID_ETH, CHAIN_ID_AVAX];

// CCTP Consts.
export const CCTP_DOMAIN_TO_CHAIN_ID = {
    0: CHAIN_ID_ETH,
    1: CHAIN_ID_AVAX,
};
export const CCTP_EMITTER_ADDRESSES = {
    [CHAIN_ID_ETH]: "0x26413e8157CD32011E726065a5462e97dD4d03D9",
    [CHAIN_ID_AVAX]: "0xa9fB1b3009DCb79E2fe346c16a604B8Fa8aE0a79",
};
export const CIRCLE_BURN_MESSAGE_TOPIC =
    "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

// Testnet guardian host.
export const TESTNET_GUARDIAN_RPC: string[] = ["https://wormhole-v2-testnet-api.certus.one"];
