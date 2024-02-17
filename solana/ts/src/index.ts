export * from "./cctp";
export * from "./messages";

import { SendOptions } from "@solana/web3.js";

import {
    AddressLookupTableAccount,
    PublicKey,
    Signer,
    TransactionInstruction,
} from "@solana/web3.js";

export type PreparedTransaction = {
    ixs: TransactionInstruction[];
    signers: Signer[];
    computeUnits: number;
    feeMicroLamports: number;
    nonceAccount: PublicKey;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
    txName?: string;
    sendOptions?: SendOptions;
};

export type PreparedTransactionOptions = {
    feeMicroLamports: number;
    computeUnits: number;
    nonceAccount: PublicKey;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
};
