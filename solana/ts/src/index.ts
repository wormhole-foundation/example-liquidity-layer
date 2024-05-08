import { ConfirmOptions } from "@solana/web3.js";

import {
    AddressLookupTableAccount,
    PublicKey,
    Signer,
    TransactionInstruction,
} from "@solana/web3.js";
import { cctpMessageAddress } from "./common";

export type PreparedTransaction = {
    ixs: TransactionInstruction[];
    signers: Signer[];
    computeUnits: number;
    feeMicroLamports: number;
    nonceAccount?: PublicKey;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
    txName?: string;
    confirmOptions?: ConfirmOptions;
};

export type PreparedTransactionOptions = {
    feeMicroLamports: number;
    computeUnits: number;
    nonceAccount?: PublicKey;
    addressLookupTableAccounts?: AddressLookupTableAccount[];
};

export * from "./cctp";
export * from "./common";
export * from "./idl";
export * from "./tokenRouter";
export * from "./wormhole";
