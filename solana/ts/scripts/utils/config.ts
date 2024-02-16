import * as wormholeSdk from "@certusone/wormhole-sdk";
import * as splToken from "@solana/spl-token";
import { IWormhole__factory } from "@certusone/wormhole-sdk/lib/cjs/ethers-contracts";
import { Commitment, PublicKey, PublicKeyInitData } from "@solana/web3.js";
import {
    Environment,
    ParsedVaaWithBytes,
    ProvidersOpts,
} from "@wormhole-foundation/relayer-engine";
import { ethers } from "ethers";
import { USDC_MINT_ADDRESS } from "../../tests/helpers";

export const EVM_FAST_CONSISTENCY_LEVEL = 200;

export const CCTP_ATTESTATION_ENDPOINT_TESTNET = "https://iris-api-sandbox.circle.com";
export const CCTP_ATTESTATION_ENDPOINT_MAINNET = "https://iris-api.circle.com";

export type InputEndpointChainConfig = {
    chain: wormholeSdk.ChainName;
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
    commitment: Commitment;
    nonceAccount: PublicKeyInitData;
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
    settleAuctionActive: number;
    initiateAuction: number;
};

export type PricingParameters = {
    chain: wormholeSdk.ChainName;
    probability: number;
    edgePctOfFv: number;
};

export type EnvironmentConfig = {
    environment: Environment;
    logging: LoggingConfig;
    connection: SolanaConnectionConfig;
    sourceTxHash: SourceTxHashConfig;
    computeUnits: ComputeUnitsConfig;
    pricing?: PricingParameters[];
    endpointConfig: InputEndpointChainConfig[];
    knownAtaOwners: PublicKey[];
};

export type ChainConfig = InputEndpointChainConfig & {
    fastConsistencyLevel?: number;
};

export enum ChainType {
    Evm,
    Solana,
}

interface StartingSequences {
    [key: number | wormholeSdk.ChainId]: number;
}
export class AppConfig {
    private _cfg: EnvironmentConfig;

    private _chainCfgs: Partial<{ [k: number]: ChainConfig }>;

    private _wormholeAddresses: {
        [k in wormholeSdk.ChainName]: { core?: string; token_bridge?: string; nft_bridge?: string };
    };

    constructor(input: any) {
        this._cfg = validateEnvironmentConfig(input);

        this._chainCfgs = this._cfg.endpointConfig
            .map((cfg) => ({
                ...cfg,
                fastConsistencyLevel: wormholeSdk.isEVMChain(cfg.chain)
                    ? EVM_FAST_CONSISTENCY_LEVEL
                    : undefined,
            }))
            .reduce((acc, cfg) => ({ ...acc, [wormholeSdk.coalesceChainId(cfg.chain)]: cfg }), {});

        this._wormholeAddresses =
            this._cfg.environment == Environment.MAINNET
                ? wormholeSdk.utils.CONTRACTS.MAINNET
                : wormholeSdk.utils.CONTRACTS.TESTNET;
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

    solanaRpc(): string {
        return this._cfg.connection.rpc;
    }

    solanaCommitment(): Commitment {
        return this._cfg.connection.commitment;
    }

    solanaNonceAccount(): PublicKey {
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

    initiateAuctionComputeUnits(): number {
        return this._cfg.computeUnits.initiateAuction;
    }

    settleAuctionActiveComputeUnits(): number {
        return this._cfg.computeUnits.settleAuctionActive;
    }

    knownAtaOwners(): PublicKey[] {
        return this._cfg.knownAtaOwners;
    }

    recognizedTokenAccounts(): PublicKey[] {
        return this._cfg.knownAtaOwners.map((key) => {
            return splToken.getAssociatedTokenAddressSync(USDC_MINT_ADDRESS, new PublicKey(key));
        });
    }

    relayerAppProviderOpts(): ProvidersOpts {
        return {
            chains: this._cfg.endpointConfig.reduce(
                (acc, cfg) => ({
                    ...acc,
                    [wormholeSdk.coalesceChainId(cfg.chain)]: { endpoints: [cfg.endpoint] },
                }),
                {},
            ),
        };
    }

    pricingParameters(chainId: wormholeSdk.ChainId | number): PricingParameters {
        if (this._cfg.pricing === undefined) {
            throw new Error("pricing is not defined");
        }

        const pricing = this._cfg.pricing.find(
            (p) => wormholeSdk.coalesceChainId(p.chain) === chainId,
        );

        if (pricing === undefined) {
            throw new Error(`pricing for chain ${chainId} is not defined`);
        } else {
            return pricing;
        }
    }

    unsafeChainCfg(chain: number): { coreBridgeAddress: string } & ChainConfig {
        const chainCfg = this._chainCfgs[chain]!;
        return {
            coreBridgeAddress: this._wormholeAddresses[chainCfg.chain].core!,
            ...chainCfg,
        };
    }

    async startingSeqeunces(): Promise<StartingSequences> {
        const sequences: StartingSequences = {};
        for (const cfg of this._cfg.endpointConfig) {
            const chainId = wormholeSdk.coalesceChainId(cfg.chain);
            if (wormholeSdk.isEVMChain(cfg.chain)) {
                sequences[chainId] = await this.fetchStartingSequenceEvm(chainId);
            }
        }

        return sequences;
    }

    async fetchStartingSequenceEvm(chainId: wormholeSdk.ChainId): Promise<number> {
        const chainCfg = this._chainCfgs[chainId];

        if (chainCfg === undefined) {
            throw new Error(`chain ${chainId} is not configured`);
        }

        const provider = new ethers.providers.JsonRpcProvider(chainCfg.rpc);
        const wormhole = IWormhole__factory.connect(
            this._wormholeAddresses[chainCfg.chain].core!,
            provider,
        );
        const sequence = await wormhole.nextSequence(chainCfg.endpoint);
        return sequence.toNumber();
    }

    defaultMissedVaaOptions(): {
        startingSequenceConfig: Partial<{ [k in wormholeSdk.ChainId]: bigint }>;
        forceSeenKeysReindex: boolean;
    } {
        return {
            startingSequenceConfig: this._cfg.endpointConfig.reduce(
                (acc, cfg) => ({
                    ...acc,
                    [wormholeSdk.coalesceChainId(cfg.chain)]: 0n,
                }),
                {},
            ),
            forceSeenKeysReindex: false,
        };
    }

    cctpAttestationEndpoint(): string {
        return this._cfg.environment == Environment.MAINNET
            ? CCTP_ATTESTATION_ENDPOINT_MAINNET
            : CCTP_ATTESTATION_ENDPOINT_TESTNET;
    }

    emitterFilter(): Partial<{ [k in wormholeSdk.ChainId]: string[] | string }> {
        return this._cfg.endpointConfig.reduce(
            (acc, cfg) => ({ ...acc, [wormholeSdk.coalesceChainId(cfg.chain)]: cfg.endpoint }),
            {},
        );
    }

    isFastFinality(vaa: ParsedVaaWithBytes): boolean {
        return (
            vaa.consistencyLevel ==
            this._chainCfgs[vaa.emitterChain as wormholeSdk.ChainId]?.fastConsistencyLevel
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
            key !== "commitment" &&
            key !== "nonceAccount" &&
            key !== "addressLookupTable"
        ) {
            throw new Error(`unexpected key: connection.${key}`);
        } else if (cfg.connection[key] === undefined) {
            throw new Error(`connection.${key} is required`);
        }
    }

    // check nonce account pubkey
    new PublicKey(cfg.connection.nonceAccount);

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
            key !== "settleAuctionActive" &&
            key !== "initiateAuction"
        ) {
            throw new Error(`unexpected key: computeUnits.${key}`);
        } else if (cfg.computeUnits[key] === undefined) {
            throw new Error(`computeUnits.${key} is required`);
        }
    }

    // Pricing
    if (cfg.pricing !== undefined && Array.isArray(cfg.pricing)) {
        for (const pricingParameter of cfg.pricing) {
            if (pricingParameter.chain === undefined) {
                throw new Error("pricingParameter.chain is required");
            }
            if (!(pricingParameter.chain in wormholeSdk.CHAINS)) {
                throw new Error(`invalid chain: ${pricingParameter.chain}`);
            }
            if (pricingParameter.probability === undefined) {
                throw new Error("pricingParameter.probability is required");
            } else {
                if (pricingParameter.probability <= 0 || pricingParameter.probability > 1) {
                    throw new Error("pricingParameter.probability must be in (0, 1]");
                }
            }
            if (pricingParameter.edgePctOfFv === undefined) {
                throw new Error("pricingParameter.edgePctOfFv is required");
            } else {
                if (pricingParameter.edgePctOfFv < 0) {
                    throw new Error("pricingParameter.edgePctOfFv must be non-negative");
                }
            }
        }
    }

    // endpointConfig
    if (!Array.isArray(cfg.endpointConfig)) {
        throw new Error("endpointConfig must be an array");
    }
    if (cfg.endpointConfig.length === 0) {
        throw new Error("endpointConfig must contain at least one element");
    }
    for (const endpointConfig of cfg.endpointConfig) {
        const { chain, rpc, endpoint } = endpointConfig;
        if (chain === undefined) {
            throw new Error("endpointConfig.chain is required");
        }
        if (!(chain in wormholeSdk.CHAINS)) {
            throw new Error(`invalid chain: ${chain}`);
        }
        if (endpointConfig.chainType === undefined) {
            throw new Error("endpointConfig.chainType is required");
        }
        if (
            endpointConfig.chainType !== ChainType.Evm &&
            endpointConfig.chainType !== ChainType.Solana
        ) {
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
        wormholeSdk.tryNativeToHexString(endpoint, chain);
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
            settleAuctionActive: cfg.computeUnits.settleAuctionActive,
            initiateAuction: cfg.computeUnits.initiateAuction,
        },
        pricing: cfg.pricing,
        knownAtaOwners: cfg.knownAtaOwners,
        endpointConfig: cfg.endpointConfig,
    };
}
