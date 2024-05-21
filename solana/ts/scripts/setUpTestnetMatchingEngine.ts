import * as splToken from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { uint64ToBN } from "../src/common";
import { AuctionParameters, MatchingEngineProgram } from "../src/matchingEngine";
import { TokenRouterProgram } from "../src/tokenRouter";
import { Chain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";

const MATCHING_ENGINE_ID = "mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS";
const TOKEN_ROUTER_ID = "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const AUCTION_PARAMS: AuctionParameters = {
    userPenaltyRewardBps: 400000, // 40%
    initialPenaltyBps: 250000, // 25%
    duration: 5, // slots
    gracePeriod: 10, // slots
    penaltyPeriod: 20, // slots
    minOfferDeltaBps: 50000, // 5%
    securityDepositBase: uint64ToBN(1000000n), // 1 USDC
    securityDepositBps: 5000, // 0.5%
};

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const matchingEngine = new MatchingEngineProgram(connection, MATCHING_ENGINE_ID, USDC_MINT);
    const tokenRouter = new TokenRouterProgram(connection, TOKEN_ROUTER_ID, USDC_MINT);

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "base64"));

    // Set up program.
    await intialize(matchingEngine, payer);

    // Add endpoints.
    //
    // CCTP Domains listed here: https://developers.circle.com/stablecoins/docs/supported-domains.
    {
        // https://explorer.solana.com/address/tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md?cluster=devnet
        await addLocalRouterEndpoint(matchingEngine, payer, tokenRouter);
    }
    {
        // https://sepolia.etherscan.io/address/0xE57D917bf955FedE2888AAbD056202a6497F1882
        const foreignChain = "Sepolia";
        const foreignEmitter = "0xE57D917bf955FedE2888AAbD056202a6497F1882";
        const cctpDomain = 0;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://testnet.snowtrace.io/address/0x8Cd7D7C980cd72eBD16737dC3fa04469dcFcf07A
        const foreignChain = "Avalanche";
        const foreignEmitter = "0x8Cd7D7C980cd72eBD16737dC3fa04469dcFcf07A";
        const cctpDomain = 1;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia-optimism.etherscan.io/address/0x6BAa7397c18abe6221b4f6C3Ac91C88a9faE00D8
        const foreignChain = "OptimismSepolia";
        const foreignEmitter = "0x6BAa7397c18abe6221b4f6C3Ac91C88a9faE00D8";
        const cctpDomain = 2;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia.arbiscan.io/address/0xe0418C44F06B0b0D7D1706E01706316DBB0B210E
        const foreignChain = "ArbitrumSepolia";
        const foreignEmitter = "0xe0418C44F06B0b0D7D1706E01706316DBB0B210E";
        const cctpDomain = 3;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://sepolia.basescan.org/address/0x824Ea687CD1CC2f2446235D33Ae764CbCd08e18C
        const foreignChain = "BaseSepolia";
        const foreignEmitter = "0x824Ea687CD1CC2f2446235D33Ae764CbCd08e18C";
        const cctpDomain = 6;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
    {
        // https://mumbai.polygonscan.com/address/0xa098368AaaDc0FdF3e309cda710D7A5f8BDEeCD9
        const foreignChain = "PolygonSepolia";
        const foreignEmitter = "0xa098368AaaDc0FdF3e309cda710D7A5f8BDEeCD9";
        const cctpDomain = 7;

        await addCctpRouterEndpoint(
            matchingEngine,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null,
        );
    }
}

async function intialize(matchingEngine: MatchingEngineProgram, payer: Keypair) {
    const connection = matchingEngine.program.provider.connection;

    const custodian = matchingEngine.custodianAddress();
    console.log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        console.log("already initialized");
        return;
    }

    const ix = await matchingEngine.initializeIx(
        {
            owner: payer.publicKey,
            ownerAssistant: payer.publicKey,
            feeRecipient: payer.publicKey,
        },
        AUCTION_PARAMS,
    );

    await splToken.getOrCreateAssociatedTokenAccount(connection, payer, USDC_MINT, payer.publicKey);

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
        .catch((err) => {
            console.log(err.logs);
            throw err;
        })
        .then((txSig) => {
            console.log("intialize", txSig);
        });
}

async function addCctpRouterEndpoint(
    matchingEngine: MatchingEngineProgram,
    payer: Keypair,
    foreignChain: Chain,
    cctpDomain: number,
    foreignEmitter: string,
    foreignMintRecipient: string | null,
) {
    await matchingEngine.fetchCustodian().catch((_) => {
        throw new Error("no custodian found");
    });

    const connection = matchingEngine.program.provider.connection;

    const chain = toChainId(foreignChain);
    const endpoint = matchingEngine.routerEndpointAddress(chain);
    const exists = await connection.getAccountInfo(endpoint).then((acct) => acct != null);

    const endpointAddress = Array.from(toUniversal(foreignChain, foreignEmitter).unwrap());
    const endpointMintRecipient =
        foreignMintRecipient === null
            ? null
            : Array.from(toUniversal(foreignChain, foreignMintRecipient).unwrap());

    const [ix, action] = await (async () => {
        if (exists) {
            const { address, mintRecipient } = await matchingEngine.fetchRouterEndpointInfo(chain);
            if (
                Buffer.from(address).equals(Buffer.from(endpointAddress)) &&
                Buffer.from(mintRecipient).equals(
                    Buffer.from(endpointMintRecipient ?? endpointAddress),
                )
            ) {
                return [null, null];
            } else {
                const ix = await matchingEngine.updateCctpRouterEndpointIx(
                    { owner: payer.publicKey },
                    {
                        chain,
                        address: endpointAddress,
                        mintRecipient: endpointMintRecipient,
                        cctpDomain,
                    },
                );
                return [ix, "updated"];
            }
        } else {
            const ix = await matchingEngine.addCctpRouterEndpointIx(
                {
                    ownerOrAssistant: payer.publicKey,
                },
                {
                    chain,
                    address: endpointAddress,
                    mintRecipient: endpointMintRecipient,
                    cctpDomain,
                },
            );
            return [ix, "added"];
        }
    })();

    if (action === null) {
        console.log(
            "endpoint already exists",
            foreignChain,
            "addr",
            foreignEmitter,
            "domain",
            cctpDomain,
            "mintRecipient",
            foreignMintRecipient,
        );
    } else {
        const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
            payer,
        ]);
        console.log(
            action,
            "endpoint",
            txSig,
            "chain",
            foreignChain,
            "addr",
            foreignEmitter,
            "domain",
            cctpDomain,
            "mintRecipient",
            foreignMintRecipient,
        );
    }
}

async function addLocalRouterEndpoint(
    matchingEngine: MatchingEngineProgram,
    payer: Keypair,
    tokenRouter: TokenRouterProgram,
) {
    await matchingEngine.fetchCustodian().catch((_) => {
        throw new Error("no custodian found");
    });

    const connection = matchingEngine.program.provider.connection;

    const chain = toChainId("Solana");
    const endpoint = matchingEngine.routerEndpointAddress(chain);
    const exists = await connection.getAccountInfo(endpoint).then((acct) => acct != null);

    const endpointAddress = Array.from(
        toUniversal("Solana", tokenRouter.custodianAddress().toString()).unwrap(),
    );
    const endpointMintRecipient = Array.from(
        toUniversal("Solana", tokenRouter.cctpMintRecipientAddress().toString()).unwrap(),
    );

    if (exists) {
        const { address, mintRecipient } = await matchingEngine.fetchRouterEndpointInfo(chain);
        if (
            Buffer.from(address).equals(Buffer.from(endpointAddress)) &&
            Buffer.from(mintRecipient).equals(Buffer.from(endpointMintRecipient ?? endpointAddress))
        ) {
            console.log("local endpoint already exists", endpoint.toString());
            return;
        }
    }

    const ix = await matchingEngine.addLocalRouterEndpointIx({
        ownerOrAssistant: payer.publicKey,
        tokenRouterProgram: tokenRouter.ID,
    });
    const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
    console.log("added local endpoint", txSig, "router", tokenRouter.ID.toString());
}
