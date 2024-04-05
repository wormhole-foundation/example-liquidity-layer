import * as wormholeSdk from "@certusone/wormhole-sdk";
import { ConfirmOptions, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { PreparedTransaction } from "../../src";
import { MatchingEngineProgram } from "../../src/matchingEngine";
import { ParsedVaaWithBytes } from "@wormhole-foundation/relayer-engine";
import { AppConfig } from "./config";

function unsafeFixSigVerifyIx(sigVerifyIx: TransactionInstruction, sigVerifyIxIndex: number) {
    const { data } = sigVerifyIx;

    const numSignatures = data.readUInt8(0);

    const offsetSpan = 11;
    for (let i = 0; i < numSignatures; ++i) {
        data.writeUInt8(sigVerifyIxIndex, 3 + i * offsetSpan);
        data.writeUInt8(sigVerifyIxIndex, 6 + i * offsetSpan);
        data.writeUInt8(sigVerifyIxIndex, 11 + i * offsetSpan);
    }
}

export async function preparePostVaaTxs(
    connection: Connection,
    cfg: AppConfig,
    matchingEngine: MatchingEngineProgram,
    payer: Keypair,
    vaa: ParsedVaaWithBytes,
    confirmOptions?: ConfirmOptions,
): Promise<PreparedTransaction[]> {
    const vaaSignatureSet = Keypair.generate();

    // Check if Fast VAA has already been posted.
    const vaaVerifySignaturesIxs =
        await wormholeSdk.solana.createVerifySignaturesInstructionsSolana(
            connection,
            matchingEngine.coreBridgeProgramId(),
            payer.publicKey,
            vaa,
            vaaSignatureSet.publicKey,
        );
    vaaVerifySignaturesIxs.reverse();

    const vaaPostIx = wormholeSdk.solana.createPostVaaInstructionSolana(
        matchingEngine.coreBridgeProgramId(),
        payer.publicKey,
        vaa,
        vaaSignatureSet.publicKey,
    );

    let preparedTransactions: PreparedTransaction[] = [];
    while (vaaVerifySignaturesIxs.length > 0) {
        const sigVerifyIx = vaaVerifySignaturesIxs.pop()!;
        // This is a spicy meatball. Advance nonce ix + two compute budget ixs precede the
        // sig verify ix.
        unsafeFixSigVerifyIx(sigVerifyIx, 3);
        const verifySigsIx = vaaVerifySignaturesIxs.pop()!;

        const preparedVerify: PreparedTransaction = {
            ixs: [sigVerifyIx, verifySigsIx],
            signers: [payer, vaaSignatureSet],
            computeUnits: cfg.verifySignaturesComputeUnits(),
            feeMicroLamports: 10,
            nonceAccount: cfg.solanaNonceAccount(),
            txName: "verifySignatures",
            confirmOptions,
        };

        const preparedPost: PreparedTransaction = {
            ixs: [vaaPostIx],
            signers: [payer],
            computeUnits: cfg.postVaaComputeUnits(),
            feeMicroLamports: 10,
            nonceAccount: cfg.solanaNonceAccount(),
            txName: "postVAA",
            confirmOptions,
        };

        preparedTransactions.push(preparedVerify, preparedPost);
    }

    return preparedTransactions;
}
