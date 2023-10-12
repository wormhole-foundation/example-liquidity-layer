import {
  CHAIN_ID_AVAX,
  CHAIN_ID_ETH,
  tryNativeToHexString,
} from "@certusone/wormhole-sdk";
import { ethers } from "ethers";

export type NetworkVars<T> = {
  avalanche: T;
  ethereum: T;
  bsc: T;
  moonbeam: T;
};

// Avalanche Mainnet Fork
export const LOCALHOSTS: NetworkVars<string> = {
  avalanche: "http://localhost:8547",
  ethereum: "http://localhost:8548",
  bsc: "http://localhost:8549",
  moonbeam: "http://localhost:8550",
};

export const USDC_ADDRESSES: NetworkVars<string> = {
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  moonbeam: "0x931715FEE2d06333043d11F658C8CE934aC61D0c",
};

export const POLYGON_USDC_ADDRESS =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

export const USDC_DECIMALS: NetworkVars<number> = {
  avalanche: 6,
  ethereum: 6,
  bsc: 18,
  moonbeam: 6,
};

export const WORMHOLE_MESSAGE_FEE = 0;
export const WORMHOLE_GUARDIAN_SET_INDEX = 3;
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

export const CURVE_FACTORY_ADDRESS =
  "0xb17b674D9c5CB2e441F8e196a2f048A81355d031";
export const MATCHING_ENGINE_POOL_COINS: [string, string, string, string] = [
  "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // avalanche USDC
  "0xB24CA28D4e2742907115fECda335b40dbda07a4C", // wrapped ethereum USDC
  "0x543672E9CBEC728CBBa9C3Ccd99ed80aC3607FA8", // wrapped polygon USDC
  "0x6145E8a910aE937913426BF32De2b26039728ACF", // wrapped bsc USDC
];

export enum TokenType {
  Unset,
  Native,
  Canonical,
  Cctp,
}

export const TOKEN_TYPES: NetworkVars<TokenType> = {
  avalanche: TokenType.Cctp,
  ethereum: TokenType.Cctp,
  bsc: TokenType.Native,
  moonbeam: TokenType.Canonical,
};
