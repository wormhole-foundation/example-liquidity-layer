import { FastTransferParameters } from "../../src";

export type ValidNetwork = "Avalanche" | "Ethereum" | "Base";

export type NetworkVars<T> = {
    [key in ValidNetwork]?: T;
};

// Avalanche Mainnet Fork
export const LOCALHOSTS: NetworkVars<string> = {
    Avalanche: "http://127.0.0.1:8547",
    Ethereum: "http://127.0.0.1:8548",
    Base: "http://127.0.0.1:8549",
};

export const USDC_DECIMALS: NetworkVars<number> = {
    Avalanche: 6,
    Ethereum: 6,
    Base: 6,
};

export const WORMHOLE_MESSAGE_FEE = 0;
export const WORMHOLE_GUARDIAN_SET_INDEX = 4;
export const GUARDIAN_PRIVATE_KEY =
    "cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0";
export const WALLET_PRIVATE_KEYS = [
    "4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1",
    "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    "0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913",
    "0xadd53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743",
    "0x395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd",
    "0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52",
    "0xa453611d9419d0e56f499079478fd72c37b251a94bfde4d19872c44cf65386e3",
    "0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4",
    "0xb0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773",
];

// Arbitrarily decided.
export const OWNER_PRIVATE_KEY = WALLET_PRIVATE_KEYS[9];
export const OWNER_ASSISTANT_PRIVATE_KEY = WALLET_PRIVATE_KEYS[8];

export const MATCHING_ENGINE_CHAIN = 6;
export const MATCHING_ENGINE_NAME = "Avalanche";

export const DEFAULT_FAST_TRANSFER_PARAMS: FastTransferParameters = {
    enabled: true,
    maxAmount: BigInt(500000000000),
    baseFee: BigInt(100000),
    initAuctionFee: BigInt(100000),
};
