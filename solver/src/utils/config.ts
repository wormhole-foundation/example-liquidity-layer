// required for `toNative` to register the addresses
import "@wormhole-foundation/sdk-evm/address";
import "@wormhole-foundation/sdk-solana/address";

import * as splToken from "@solana/spl-token";
import { Commitment, Connection, FetchFn, PublicKey, PublicKeyInitData } from "@solana/web3.js";
import { ethers } from "ethers";
import { USDC_MINT_ADDRESS } from "@wormhole-foundation/example-liquidity-layer-solana/testing";
import { defaultLogger } from "./logger";
import {
    Chain,
    chainToPlatform,
    chains,
    contracts,
    isChain,
    toChainId,
} from "@wormhole-foundation/sdk-base";
import { VAA, toNative } from "@wormhole-foundation/sdk-definitions";

export const EVM_FAST_CONSISTENCY_LEVEL = 200;

export const CCTP_ATTESTATION_ENDPOINT_TESTNET = "https://iris-api-sandbox.circle.com";
export const CCTP_ATTESTATION_ENDPOINT_MAINNET = "https://iris-api.circle.com";
export const WORMHOLESCAN_VAA_ENDPOINT_TESTNET = "https://api.testnet.wormholescan.io/api/v1/vaas/";
export const WORMHOLESCAN_VAA_ENDPOINT_MAINNET = "https://api.wormholescan.io/api/v1/vaas/";

enum Environment {
    MAINNET = "Mainnet",
    TESTNET = "Testnet",
    DEVNET = "Devnet",
}

export type InputEndpointChainConfig = {
    chain: Chain;
    chainType: ChainType;
    rpc: string;
    endpoint: string;
};

export type SourceTxHashConfig = {
    maxRetries: number;
    retryBackoff: number;
};

export type SolanaConnectionConfig = {
    rpc: string;
    ws?: string;
    commitment: Commitment;
    nonceAccount?: PublicKeyInitData;
    addressLookupTable: PublicKeyInitData;
};

export type LoggingConfig = {
    app: string;
    logic: string;
};

export type ComputeUnitsConfig = {
    verifySignatures: number;
    postVaa: number;
    settleAuctionNoneCctp: number;
    settleAuctionNoneLocal: number;
    settleAuctionComplete: number;
    initiateAuction: number;
};

export type PricingParameters = {
    chain: Chain;
    probability: number;
    edgePctOfFv: number;
};

export type EnvironmentConfig = {
    environment: Environment;
    logging: LoggingConfig;
    connection: SolanaConnectionConfig;
    sourceTxHash: SourceTxHashConfig;
    computeUnits: ComputeUnitsConfig;
    pricing: PricingParameters[];
    endpointConfig: InputEndpointChainConfig[];
    knownAtaOwners: string[];
};

export type ChainConfig = InputEndpointChainConfig & {
    fastConsistencyLevel?: number;
};

export enum ChainType {
    Evm,
    Solana,
}

export class AppConfig {
    private _cfg: EnvironmentConfig;

    private _chainCfgs: Partial<{ [k: number]: ChainConfig }>;

    private _wormholeAddresses: {
        [k in Chain]?: { core?: string; token_bridge?: string; nft_bridge?: string };
    };

    constructor(input: any) {
        this._cfg = validateEnvironmentConfig(input);

        this._chainCfgs = this._cfg.endpointConfig
            .map((cfg) => ({
                ...cfg,
                fastConsistencyLevel:
                    chainToPlatform(cfg.chain) === "Evm" ? EVM_FAST_CONSISTENCY_LEVEL : undefined,
            }))
            .reduce((acc, cfg) => ({ ...acc, [toChainId(cfg.chain)]: cfg }), {});

        this._wormholeAddresses = Object.fromEntries(
            chains.map((chain) => {
                return [
                    chain,
                    {
                        core: contracts.coreBridge.get(this._cfg.environment, chain),
                        token_bridge: contracts.tokenBridge.get(this._cfg.environment, chain),
                        nft_bridge: contracts.nftBridge.get(this._cfg.environment, chain),
                    },
                ];
            }) as [Chain, { core?: string; token_bridge?: string; nft_bridge?: string }][],
        );
    }

    appLogLevel(): string {
        return this._cfg.logging.app;
    }

    logicLogLevel(): string {
        return this._cfg.logging.logic;
    }

    sourceTxHash(): { maxRetries: number; retryBackoff: number } {
        return this._cfg.sourceTxHash;
    }

    solanaConnection(debug: boolean = false): Connection {
        const fetchLogger = defaultLogger({ label: "fetch", level: debug ? "debug" : "error" });
        fetchLogger.debug("Start debug logging Solana connection fetches.");

        return new Connection(this._cfg.connection.rpc, {
            commitment: this._cfg.connection.commitment,
            wsEndpoint: this._cfg.connection.ws,
            fetchMiddleware: function (
                info: Parameters<FetchFn>[0],
                init: Parameters<FetchFn>[1],
                fetch: (...a: Parameters<FetchFn>) => void,
            ) {
                if (init !== undefined) {
                    // @ts-ignore: init is not null
                    fetchLogger.debug(init.body!);
                }
                return fetch(info, init);
            },
        });
    }

    solanaRpc(): string {
        return this._cfg.connection.rpc;
    }

    solanaCommitment(): Commitment {
        return this._cfg.connection.commitment;
    }

    solanaNonceAccount(): PublicKey {
        if (this._cfg.connection.nonceAccount === undefined) {
            throw new Error("nonceAccount is not configured");
        }

        return new PublicKey(this._cfg.connection.nonceAccount);
    }

    solanaAddressLookupTable(): PublicKey {
        return new PublicKey(this._cfg.connection.addressLookupTable);
    }

    verifySignaturesComputeUnits(): number {
        return this._cfg.computeUnits.verifySignatures;
    }

    postVaaComputeUnits(): number {
        return this._cfg.computeUnits.postVaa;
    }

    settleAuctionNoneCctpComputeUnits(): number {
        return this._cfg.computeUnits.settleAuctionNoneCctp;
    }

    settleAuctionNoneLocalComputeUnits(): number {
        return this._cfg.computeUnits.settleAuctionNoneLocal;
    }

    settleAuctionCompleteComputeUnits(): number {
        return this._cfg.computeUnits.settleAuctionComplete;
    }

    initiateAuctionComputeUnits(): number {
        return this._cfg.computeUnits.initiateAuction;
    }

    knownAtaOwners(): PublicKey[] {
        return this._cfg.knownAtaOwners.map((key) => new PublicKey(key));
    }

    recognizedTokenAccounts(): PublicKey[] {
        return this.knownAtaOwners().map((key) => {
            return splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, key);
        });
    }

    isRecognizedTokenAccount(tokenAccount: PublicKey): boolean {
        return this.recognizedTokenAccounts().some((key) => key.equals(tokenAccount));
    }

    pricingParameters(chain: number): PricingParameters | null {
        const pricing = this._cfg.pricing.find((p) => toChainId(p.chain) == chain);

        return pricing === undefined ? null : pricing;
    }

    unsafeChainCfg(chain: number): { coreBridgeAddress: string } & ChainConfig {
        const chainCfg = this._chainCfgs[chain]!;
        return {
            coreBridgeAddress: this._wormholeAddresses![chainCfg.chain]!.core!,
            ...chainCfg,
        };
    }

    cctpAttestationEndpoint(): string {
        return this._cfg.environment == Environment.MAINNET
            ? CCTP_ATTESTATION_ENDPOINT_MAINNET
            : CCTP_ATTESTATION_ENDPOINT_TESTNET;
    }

    wormholeScanVaaEndpoint(): string {
        return this._cfg.environment == Environment.MAINNET
            ? WORMHOLESCAN_VAA_ENDPOINT_MAINNET
            : WORMHOLESCAN_VAA_ENDPOINT_TESTNET;
    }

    emitterFilterForSpy(): { chain: Chain; nativeAddress: string }[] {
        return this._cfg.endpointConfig.map((cfg) => ({
            chain: cfg.chain,
            nativeAddress: cfg.endpoint,
        }));
    }

    isFastFinality(vaa: VAA): boolean {
        return (
            vaa.consistencyLevel ==
            this._chainCfgs[toChainId(vaa.emitterChain)]?.fastConsistencyLevel
        );
    }
}

function validateEnvironmentConfig(cfg: any): EnvironmentConfig {
    // check root keys
    for (const key of Object.keys(cfg)) {
        if (
            key !== "environment" &&
            key !== "connection" &&
            key !== "logging" &&
            key !== "sourceTxHash" &&
            key !== "computeUnits" &&
            key !== "endpointConfig" &&
            key !== "pricing" &&
            key !== "knownAtaOwners"
        ) {
            throw new Error(`unexpected key: ${key}`);
        } else if (cfg[key] === undefined) {
            throw new Error(`${key} is required`);
        }
    }

    // environment
    if (cfg.environment !== Environment.MAINNET && cfg.environment !== Environment.TESTNET) {
        throw new Error(
            `environment must be either ${Environment.MAINNET} or ${Environment.TESTNET}`,
        );
    }

    // connection
    for (const key of Object.keys(cfg.connection)) {
        if (
            key !== "rpc" &&
            key !== "ws" &&
            key !== "commitment" &&
            key !== "nonceAccount" &&
            key !== "addressLookupTable"
        ) {
            throw new Error(`unexpected key: connection.${key}`);
        } else if (key !== "ws" && cfg.connection[key] === undefined) {
            throw new Error(`connection.${key} is required`);
        }
    }

    // check nonce account pubkey
    if (cfg.connection.nonceAccount !== undefined) {
        new PublicKey(cfg.connection.nonceAccount);
    }

    // check address lookup table pubkey
    new PublicKey(cfg.connection.addressLookupTable);

    // Make sure the ATA owners list is nonzero.
    if (cfg.knownAtaOwners === undefined || cfg.knownAtaOwners.length === 0) {
        throw new Error("knownAtaOwners must be a non-empty array");
    }

    // logging
    for (const key of Object.keys(cfg.logging)) {
        if (key !== "app" && key !== "logic") {
            throw new Error(`unexpected key: logging.${key}`);
        } else if (cfg.logging[key] === undefined) {
            throw new Error(`logging.${key} is required`);
        }
    }

    // sourceTxHash
    for (const key of Object.keys(cfg.sourceTxHash)) {
        if (key !== "maxRetries" && key !== "retryBackoff") {
            throw new Error(`unexpected key: sourceTxHash.${key}`);
        } else if (cfg.sourceTxHash[key] === undefined) {
            throw new Error(`sourceTxHash.${key} is required`);
        }
    }

    // computeUnits
    for (const key of Object.keys(cfg.computeUnits)) {
        if (
            key !== "verifySignatures" &&
            key !== "postVaa" &&
            key !== "settleAuctionNoneCctp" &&
            key !== "settleAuctionNoneLocal" &&
            key !== "settleAuctionComplete" &&
            key !== "initiateAuction" &&
            key !== "improveOffer"
        ) {
            throw new Error(`unexpected key: computeUnits.${key}`);
        } else if (cfg.computeUnits[key] === undefined) {
            throw new Error(`computeUnits.${key} is required`);
        }
    }

    // Pricing
    if (!Array.isArray(cfg.pricing)) {
        throw new Error("pricing must be an array");
    }

    for (const { chain, probability, edgePctOfFv } of cfg.pricing) {
        if (chain === undefined) {
            throw new Error("pricingParameter.chain is required");
        } else if (!isChain(chain)) {
            throw new Error(`invalid chain: ${chain}`);
        }

        if (probability === undefined) {
            throw new Error("pricingParameter.probability is required");
        } else if (typeof probability !== "number") {
            throw new Error("pricingParameter.probability must be a number");
        } else if (probability <= 0 || probability > 1) {
            throw new Error("pricingParameter.probability must be in (0, 1]");
        }

        if (edgePctOfFv === undefined) {
            throw new Error("pricingParameter.edgePctOfFv is required");
        } else if (typeof edgePctOfFv !== "number") {
            throw new Error("pricingParameter.edgePctOfFv must be a number");
        } else if (edgePctOfFv < 0) {
            throw new Error("pricingParameter.edgePctOfFv must be non-negative");
        }
    }

    // knownAtaOwners
    if (!Array.isArray(cfg.knownAtaOwners)) {
        throw new Error("knownAtaOwners must be an array");
    }
    for (const knownAtaOwner of cfg.knownAtaOwners) {
        new PublicKey(knownAtaOwner);
    }

    // endpointConfig
    if (!Array.isArray(cfg.endpointConfig)) {
        throw new Error("endpointConfig must be an array");
    }
    if (cfg.endpointConfig.length === 0) {
        throw new Error("endpointConfig must contain at least one element");
    }
    for (const { chain, rpc, endpoint, chainType } of cfg.endpointConfig) {
        if (chain === undefined) {
            throw new Error("endpointConfig.chain is required");
        }
        if (!isChain(chain)) {
            throw new Error(`invalid chain: ${chain}`);
        }
        if (chainType === undefined) {
            throw new Error("endpointConfig.chainType is required");
        }
        if (chainType !== ChainType.Evm && chainType !== ChainType.Solana) {
            throw new Error("endpointConfig.chainType must be either Evm or Solana");
        }
        if (rpc === undefined) {
            throw new Error("endpointConfig.rpc is required");
        }
        if (endpoint === undefined) {
            throw new Error("endpointConfig.endpoint is required");
        }
        // Address should be checksummed.
        if (endpoint != ethers.utils.getAddress(endpoint)) {
            throw new Error(
                `chain=${chain} address must be check-summed: ${ethers.utils.getAddress(endpoint)}`,
            );
        }
        // This should succeed.
        toNative(chain, endpoint).toString();
    }

    return {
        environment: cfg.environment,
        connection: {
            rpc: cfg.connection.rpc,
            commitment: cfg.connection.commitment,
            nonceAccount: cfg.connection.nonceAccount,
            addressLookupTable: cfg.connection.addressLookupTable,
        },
        logging: {
            app: cfg.logging.app,
            logic: cfg.logging.logic,
        },
        sourceTxHash: {
            maxRetries: cfg.sourceTxHash.maxRetries,
            retryBackoff: cfg.sourceTxHash.retryBackoff,
        },
        computeUnits: {
            verifySignatures: cfg.computeUnits.verifySignatures,
            postVaa: cfg.computeUnits.postVaa,
            settleAuctionNoneCctp: cfg.computeUnits.settleAuctionNoneCctp,
            settleAuctionNoneLocal: cfg.computeUnits.settleAuctionNoneLocal,
            settleAuctionComplete: cfg.computeUnits.settleAuctionComplete,
            initiateAuction: cfg.computeUnits.initiateAuction,
        },
        pricing: cfg.pricing,
        knownAtaOwners: cfg.knownAtaOwners,
        endpointConfig: cfg.endpointConfig,
    };
}
