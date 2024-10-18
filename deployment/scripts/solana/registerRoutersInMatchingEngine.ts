import {
  AccountInfo,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import "dotenv/config";
import { MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { solana, LoggerFn, contracts, getLocalDependencyAddress } from "../../helpers";
import { ProgramId as TokenRouterProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { ProgramId } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { SolanaLedgerSigner } from "@xlabs-xyz/ledger-signer-solana";
import { Chain, chainToPlatform, circle, toChain, toChainId } from "@wormhole-foundation/sdk-base";
import { toUniversal } from "@wormhole-foundation/sdk-definitions";
import { TokenRouterProgram } from "@wormhole-foundation/example-liquidity-layer-solana/tokenRouter";
import { priorityMicrolamports } from "../../helpers/solana";


solana.runOnSolana("register-routers-matching-engine", async (chain, signer, log) => {
    const matchingEngineId = getLocalDependencyAddress("matchingEngineProxy", chain) as ProgramId;

    if (chain.network === "Devnet")
      throw new Error("Devnet is not supported by USDC. Use Mainnet or Testnet.");

    const usdcMint = new PublicKey(circle.usdcContract(chain.network, "Solana"));
    const connection = new Connection(chain.rpc, solana.connectionCommitmentLevel);
    const matchingEngine = new MatchingEngineProgram(connection, matchingEngineId, usdcMint);

    const deployedTokenRouters = contracts['TokenRouterProxy'];

    for (const router of deployedTokenRouters) {
        const routerChain = toChain(router.chainId);
        const circleDomain = circle.toCircleChainId(chain.network, routerChain);
        const routerAddress = toUniversal(routerChain, router.address);

        // check if it is already registered

        if (router.chainId === 0) 
            throw new Error('Invalid chainId when registering new router endpoint');


        if (Number(router.address) === 0)
            throw new Error(`Invalid router address for chainId ${router.chainId}`);

        if (router.chainId === toChainId("Solana")) {
            // throw new Error("not implemented");
            const tokenRouterId = router.address as TokenRouterProgramId;
            const tokenRouter = new TokenRouterProgram(connection, tokenRouterId, usdcMint);
            await addSolanaCctpRouterEndpoint(matchingEngine, signer, tokenRouter, log);
        } else if (chainToPlatform(routerChain) === "Evm") {
            await addCctpRouterEndpoint(matchingEngine, signer, routerChain, circleDomain, routerAddress.toString(), null, log);
        } else {
            const operatingChain = toChain(chain.chainId);
            throw new Error(`Router registrations not implemented for operating chain ${operatingChain}, target chain ${routerChain}`);
        }
        log(`Router endpoint added for chainId ${router.chainId}`);
    }
});


async function addCctpRouterEndpoint(
    matchingEngine: MatchingEngineProgram,
    signer: SolanaLedgerSigner,
    foreignChain: Chain,
    cctpDomain: number,
    foreignEmitter: string,
    foreignMintRecipient: string | null,
    log: LoggerFn,
) {
    await matchingEngine.fetchCustodian().catch((_: unknown) => {
        throw new Error("no custodian found");
    });

    const connection = matchingEngine.program.provider.connection;

    const foreignChainId = toChainId(foreignChain);
    const endpoint = matchingEngine.routerEndpointAddress(foreignChainId);
    const exists = await connection.getAccountInfo(endpoint).then((acct: null | AccountInfo<Buffer>) => acct != null);

    const endpointAddress = Array.from(toUniversal(foreignChain, foreignEmitter).unwrap());
    const endpointMintRecipient =
        foreignMintRecipient === null
            ? null
            : Array.from(toUniversal(foreignChain, foreignMintRecipient).unwrap());

    const signerPubkey = new PublicKey(await signer.getAddress());

    const [registerIx, action] = await (async () => {
        if (exists) {
            const { address, mintRecipient } = await matchingEngine.fetchRouterEndpointInfo(foreignChainId);
            if (
                Buffer.from(address).equals(Buffer.from(endpointAddress)) &&
                Buffer.from(mintRecipient).equals(
                    Buffer.from(endpointMintRecipient ?? endpointAddress),
                )
            ) {
                return [null, "already exists"] as const;
            } else {
                // TODO: check that signer pubkey is owner
                const registerIx = await matchingEngine.updateCctpRouterEndpointIx(
                    { owner: signerPubkey },
                    {
                        chain: foreignChainId,
                        address: endpointAddress,
                        mintRecipient: endpointMintRecipient,
                        cctpDomain,
                    },
                );
                return [registerIx, "updated"] as const;
            }
        } else {
            const registerIx = await matchingEngine.addCctpRouterEndpointIx(
                {
                    ownerOrAssistant: signerPubkey,
                },
                {
                    chain: foreignChainId,
                    address: endpointAddress,
                    mintRecipient: endpointMintRecipient,
                    cctpDomain,
                },
            );
            return [registerIx, "added"] as const;
        }
    })();

    if (action === "already exists") {
        log(
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
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicrolamports });
        const instructions = [registerIx, priorityFeeIx]
        const txSig = await solana.ledgerSignAndSend(connection, instructions, []);
        log(
            `${action} endpoint`,
            txSig,
            "foreignChain",
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

async function addSolanaCctpRouterEndpoint(
    matchingEngine: MatchingEngineProgram,
    signer: SolanaLedgerSigner,
    tokenRouter: TokenRouterProgram,
    log: LoggerFn,
) {
    await matchingEngine.fetchCustodian().catch((_: unknown) => {
        throw new Error("no custodian found");
    });

    const connection = matchingEngine.program.provider.connection;

    const chain = toChainId("Solana");
    const endpoint = matchingEngine.routerEndpointAddress(chain);
    const exists = await connection.getAccountInfo(endpoint).then((acct: null | AccountInfo<Buffer>) => acct != null);

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
            log("local endpoint already exists", endpoint.toString());
            return;
        }
    }

    const signerPubkey = new PublicKey(await signer.getAddress());
    const registerIx = await matchingEngine.addLocalRouterEndpointIx({
        ownerOrAssistant: signerPubkey,
        tokenRouterProgram: tokenRouter.ID,
    });
    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicrolamports });
    const instructions = [registerIx, priorityFeeIx];
    const txSig = await solana.ledgerSignAndSend(connection, instructions, []);
    log("added local endpoint", txSig, "router", tokenRouter.ID.toString());
}