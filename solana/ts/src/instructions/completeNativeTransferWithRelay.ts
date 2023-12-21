import {
    Connection,
    PublicKey,
    PublicKeyInitData,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    TransactionInstruction,
} from "@solana/web3.js";
import { CompleteTransferNativeWithPayloadCpiAccounts } from "@certusone/wormhole-sdk/lib/cjs/solana";
import { createTokenBridgeRelayerProgramInterface } from "../program";
import {
    deriveForeignContractKey,
    deriveTmpTokenAccountKey,
    deriveRedeemerConfigKey,
    deriveRegisteredTokenKey,
} from "../state";
import {
    deriveClaimKey,
    derivePostedVaaKey,
} from "@certusone/wormhole-sdk/lib/cjs/solana/wormhole";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
    isBytes,
    ParsedTokenTransferVaa,
    parseTokenTransferVaa,
    SignedVaa,
    ChainId,
} from "@certusone/wormhole-sdk";
import {
    deriveCustodyKey,
    deriveCustodySignerKey,
    deriveEndpointKey,
    deriveRedeemerAccountKey,
    deriveTokenBridgeConfigKey,
} from "@certusone/wormhole-sdk/lib/cjs/solana/tokenBridge";

export async function createCompleteNativeTransferWithRelayInstruction(
    connection: Connection,
    programId: PublicKeyInitData,
    payer: PublicKeyInitData,
    feeRecipient: PublicKey,
    tokenBridgeProgramId: PublicKeyInitData,
    wormholeProgramId: PublicKeyInitData,
    wormholeMessage: SignedVaa | ParsedTokenTransferVaa,
    recipient: PublicKey
): Promise<TransactionInstruction> {
    const program = createTokenBridgeRelayerProgramInterface(connection, programId);

    const parsed = isBytes(wormholeMessage)
        ? parseTokenTransferVaa(wormholeMessage)
        : wormholeMessage;

    const mint = new PublicKey(parsed.tokenAddress);

    const tmpTokenAccount = deriveTmpTokenAccountKey(programId, mint);
    const tokenBridgeAccounts = getCompleteTransferNativeWithPayloadCpiAccounts(
        tokenBridgeProgramId,
        wormholeProgramId,
        payer,
        parsed,
        tmpTokenAccount
    );
    const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient);
    const feeRecipientTokenAccount = getAssociatedTokenAddressSync(mint, feeRecipient);

    return program.methods
        .completeNativeTransferWithRelay([...parsed.hash])
        .accounts({
            config: deriveRedeemerConfigKey(programId),
            foreignContract: deriveForeignContractKey(programId, parsed.emitterChain as ChainId),
            tmpTokenAccount,
            registeredToken: deriveRegisteredTokenKey(programId, new PublicKey(mint)),
            nativeRegisteredToken: deriveRegisteredTokenKey(programId, new PublicKey(NATIVE_MINT)),
            recipientTokenAccount,
            recipient,
            feeRecipientTokenAccount,
            tokenBridgeProgram: new PublicKey(tokenBridgeProgramId),
            ...tokenBridgeAccounts,
        })
        .instruction();
}

// Temporary
export function getCompleteTransferNativeWithPayloadCpiAccounts(
    tokenBridgeProgramId: PublicKeyInitData,
    wormholeProgramId: PublicKeyInitData,
    payer: PublicKeyInitData,
    vaa: SignedVaa | ParsedTokenTransferVaa,
    toTokenAccount: PublicKeyInitData
): CompleteTransferNativeWithPayloadCpiAccounts {
    const parsed = isBytes(vaa) ? parseTokenTransferVaa(vaa) : vaa;
    const mint = new PublicKey(parsed.tokenAddress);
    const cpiProgramId = new PublicKey(parsed.to);

    return {
        payer: new PublicKey(payer),
        tokenBridgeConfig: deriveTokenBridgeConfigKey(tokenBridgeProgramId),
        vaa: derivePostedVaaKey(wormholeProgramId, parsed.hash),
        tokenBridgeClaim: deriveClaimKey(
            tokenBridgeProgramId,
            parsed.emitterAddress,
            parsed.emitterChain,
            parsed.sequence
        ),
        tokenBridgeForeignEndpoint: deriveEndpointKey(
            tokenBridgeProgramId,
            parsed.emitterChain,
            parsed.emitterAddress
        ),
        toTokenAccount: new PublicKey(toTokenAccount),
        tokenBridgeRedeemer: deriveRedeemerAccountKey(cpiProgramId),
        toFeesTokenAccount: new PublicKey(toTokenAccount),
        tokenBridgeCustody: deriveCustodyKey(tokenBridgeProgramId, mint),
        mint,
        tokenBridgeCustodySigner: deriveCustodySignerKey(tokenBridgeProgramId),
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        wormholeProgram: new PublicKey(wormholeProgramId),
    };
}
