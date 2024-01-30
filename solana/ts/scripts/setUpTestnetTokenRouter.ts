import { ChainName, coalesceChainId, tryNativeToUint8Array } from "@certusone/wormhole-sdk";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import "dotenv/config";
import { TokenRouterProgram } from "../src/tokenRouter";

const PROGRAM_ID = "tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

// Here we go.
main();

// impl

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const tokenRouter = new TokenRouterProgram(connection, PROGRAM_ID, USDC_MINT);

    if (process.env.SOLANA_PRIVATE_KEY === undefined) {
        throw new Error("SOLANA_PRIVATE_KEY is undefined");
    }
    const payer = Keypair.fromSecretKey(Buffer.from(process.env.SOLANA_PRIVATE_KEY, "hex"));

    // Set up program.
    await intialize(tokenRouter, payer);

    // Add endpoints.
    //
    // CCTP Domains listed here: https://developers.circle.com/stablecoins/docs/supported-domains.
    {
        // https://sepolia.etherscan.io/address/0x603541d1Cf7178C407aA7369b67CB7e0274952e2
        const foreignChain = "sepolia";
        const foreignEmitter = "0x603541d1Cf7178C407aA7369b67CB7e0274952e2";
        const cctpDomain = 0;

        await addCctpRouterEndpoint(
            tokenRouter,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null
        );
    }
    {
        // https://testnet.snowtrace.io/address/0xdf5af760f3093034C7A6580FBd4CE66A8bEDd90A
        const foreignChain = "avalanche";
        const foreignEmitter = "0xdf5af760f3093034C7A6580FBd4CE66A8bEDd90A";
        const cctpDomain = 1;

        await addCctpRouterEndpoint(
            tokenRouter,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null
        );
    }
    {
        // https://sepolia-optimism.etherscan.io/address/0xc1Cf3501ef0b26c8A47759F738832563C7cB014A
        const foreignChain = "optimism_sepolia";
        const foreignEmitter = "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A";
        const cctpDomain = 2;

        await addCctpRouterEndpoint(
            tokenRouter,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null
        );
    }
    {
        // https://sepolia.arbiscan.io/address/0xc1cf3501ef0b26c8a47759f738832563c7cb014a
        const foreignChain = "arbitrum_sepolia";
        const foreignEmitter = "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A";
        const cctpDomain = 3;

        await addCctpRouterEndpoint(
            tokenRouter,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null
        );
    }
    {
        // TODO: This is a placeholder.
        const foreignChain = "base_sepolia";
        const foreignEmitter = "0xc1Cf3501ef0b26c8A47759F738832563C7cB014A";
        const cctpDomain = 6;

        // await addCctpRouterEndpoint(
        //     tokenRouter,
        //     payer,
        //     foreignChain,
        //     cctpDomain,
        //     foreignEmitter,
        //     null
        // );
    }
    {
        // https://mumbai.polygonscan.com/address/0x3Ce8a3aC230Eb4bCE3688f2A1ab21d986a0A0B06
        const foreignChain = "polygon";
        const foreignEmitter = "0x3Ce8a3aC230Eb4bCE3688f2A1ab21d986a0A0B06";
        const cctpDomain = 7;

        await addCctpRouterEndpoint(
            tokenRouter,
            payer,
            foreignChain,
            cctpDomain,
            foreignEmitter,
            null
        );
    }
}

async function intialize(tokenRouter: TokenRouterProgram, payer: Keypair) {
    const connection = tokenRouter.program.provider.connection;

    const custodian = tokenRouter.custodianAddress();
    console.log("custodian", custodian.toString());

    const exists = await connection.getAccountInfo(custodian).then((acct) => acct != null);
    if (exists) {
        console.log("already initialized");
        return;
    }

    const ix = await tokenRouter.initializeIx({
        owner: payer.publicKey,
        ownerAssistant: payer.publicKey,
    });

    const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
    console.log("intialize", txSig);
}

async function addCctpRouterEndpoint(
    tokenRouter: TokenRouterProgram,
    payer: Keypair,
    foreignChain: ChainName,
    cctpDomain: number,
    foreignEmitter: string,
    foreignMintRecipient: string | null
) {
    const connection = tokenRouter.program.provider.connection;

    const chain = coalesceChainId(foreignChain);
    const endpoint = tokenRouter.routerEndpointAddress(chain);
    const exists = await connection.getAccountInfo(endpoint).then((acct) => acct != null);

    const endpointAddress = Array.from(tryNativeToUint8Array(foreignEmitter, foreignChain));
    const endpointMintRecipient =
        foreignMintRecipient === null
            ? null
            : Array.from(tryNativeToUint8Array(foreignMintRecipient, foreignChain));

    if (exists) {
        const { address, mintRecipient } = await tokenRouter.fetchRouterEndpoint(chain);
        if (
            Buffer.from(address).equals(Buffer.from(endpointAddress)) &&
            Buffer.from(mintRecipient).equals(Buffer.from(endpointMintRecipient ?? endpointAddress))
        ) {
            console.log(
                "already exists",
                foreignChain,
                "addr",
                foreignEmitter,
                "domain",
                cctpDomain,
                "mintRecipient",
                foreignMintRecipient
            );
            return;
        }
    }

    const ix = await tokenRouter.addCctpRouterEndpointIx(
        {
            ownerOrAssistant: payer.publicKey,
        },
        {
            chain,
            address: endpointAddress,
            mintRecipient: endpointMintRecipient,
            cctpDomain,
        }
    );
    const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
    console.log(
        "register emitter and domain",
        txSig,
        "chain",
        foreignChain,
        "addr",
        foreignEmitter,
        "domain",
        cctpDomain,
        "mintRecipient",
        foreignMintRecipient
    );
}
