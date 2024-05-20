import { ConfirmOptions, Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { PreparedTransaction } from "@wormhole-foundation/example-liquidity-layer-solana";
import { MatchingEngineProgram } from "@wormhole-foundation/example-liquidity-layer-solana/matchingEngine";
import { AppConfig } from "./config";
import * as solanaCore from "@wormhole-foundation/sdk-solana-core";
import { VAA } from "@wormhole-foundation/sdk";

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
    vaa: VAA,
    confirmOptions?: ConfirmOptions,
): Promise<PreparedTransaction[]> {
    const vaaSignatureSet = Keypair.generate();

    // Check if Fast VAA has already been posted.
    const vaaVerifySignaturesIxs = await solanaCore.utils.createVerifySignaturesInstructions(
        connection,
        matchingEngine.coreBridgeProgramId(),
        payer.publicKey,
        vaa,
        vaaSignatureSet.publicKey,
    );
    vaaVerifySignaturesIxs.reverse();

    const vaaPostIx = solanaCore.utils.createPostVaaInstruction(
        connection,
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
        unsafeFixSigVerifyIx(sigVerifyIx, 2);
        const verifySigsIx = vaaVerifySignaturesIxs.pop()!;

        const preparedVerify: PreparedTransaction = {
            ixs: [sigVerifyIx, verifySigsIx],
            signers: [payer, vaaSignatureSet],
            computeUnits: cfg.verifySignaturesComputeUnits(),
            feeMicroLamports: 10,
            txName: "verifySignatures",
            confirmOptions,
        };

        const preparedPost: PreparedTransaction = {
            ixs: [vaaPostIx],
            signers: [payer],
            computeUnits: cfg.postVaaComputeUnits(),
            feeMicroLamports: 10,
            txName: "postVAA",
            confirmOptions,
        };

        preparedTransactions.push(preparedVerify, preparedPost);
    }

    return preparedTransactions;
}
