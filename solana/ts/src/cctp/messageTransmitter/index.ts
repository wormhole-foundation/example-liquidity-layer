import { Program } from "anchor-0.29.0";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { CctpTokenBurnMessage } from "../messages";
import { TokenMessengerMinterProgram } from "../tokenMessengerMinter";
import { IDL, MessageTransmitter } from "../types/message_transmitter";
import { MessageSent } from "./MessageSent";
import { MessageTransmitterConfig } from "./MessageTransmitterConfig";
import { UsedNonses } from "./UsedNonces";
import { CircleContracts } from "@wormhole-foundation/sdk-base/contracts";

export type ReceiveTokenMessengerMinterMessageAccounts = {
    authority: PublicKey;
    messageTransmitterConfig: PublicKey;
    usedNonces: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
    messageTransmitterEventAuthority: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    tokenPair: PublicKey;
    custodyToken: PublicKey;
    tokenMessengerMinterEventAuthority: PublicKey;
};

export class MessageTransmitterProgram {
    program: Program<MessageTransmitter>;

    constructor(connection: Connection, private contracts: CircleContracts) {
        const programId = new PublicKey(contracts.messageTransmitter);
        this.program = new Program(IDL, new PublicKey(programId), { connection });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    messageTransmitterConfigAddress(): PublicKey {
        return MessageTransmitterConfig.address(this.ID);
    }

    async fetchMessageTransmitterConfig(addr: PublicKey): Promise<MessageTransmitterConfig> {
        return this.program.account.messageTransmitter.fetch(addr);
    }

    usedNoncesAddress(remoteDomain: number, nonce: bigint): PublicKey {
        return UsedNonses.address(this.ID, remoteDomain, nonce);
    }

    authorityAddress(cpiProgramId: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("message_transmitter_authority"), cpiProgramId.toBuffer()],
            this.ID,
        )[0];
    }

    eventAuthorityAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], this.ID)[0];
    }

    async fetchMessageSent(addr: PublicKey): Promise<MessageSent> {
        return this.program.account.messageSent.fetch(addr);
    }

    tokenMessengerMinterProgram(): TokenMessengerMinterProgram {
        return new TokenMessengerMinterProgram(this.program.provider.connection, this.contracts);
    }

    receiveTokenMessengerMinterMessageAccounts(
        mint: PublicKey,
        circleMessage: CctpTokenBurnMessage | Buffer,
    ): ReceiveTokenMessengerMinterMessageAccounts {
        const {
            cctp: { sourceDomain, nonce },
            burnTokenAddress,
        } = CctpTokenBurnMessage.from(circleMessage);

        const tokenMessengerMinterProgram = this.tokenMessengerMinterProgram();
        return {
            authority: this.authorityAddress(tokenMessengerMinterProgram.ID),
            messageTransmitterConfig: this.messageTransmitterConfigAddress(),
            usedNonces: this.usedNoncesAddress(sourceDomain, nonce),
            tokenMessengerMinterProgram: tokenMessengerMinterProgram.ID,
            messageTransmitterEventAuthority: this.eventAuthorityAddress(),
            messageTransmitterProgram: this.ID,
            tokenMessenger: tokenMessengerMinterProgram.tokenMessengerAddress(),
            remoteTokenMessenger:
                tokenMessengerMinterProgram.remoteTokenMessengerAddress(sourceDomain),
            tokenMinter: tokenMessengerMinterProgram.tokenMinterAddress(),
            localToken: tokenMessengerMinterProgram.localTokenAddress(mint),
            tokenPair: tokenMessengerMinterProgram.tokenPairAddress(sourceDomain, burnTokenAddress),
            custodyToken: tokenMessengerMinterProgram.custodyTokenAddress(mint),
            tokenMessengerMinterEventAuthority: tokenMessengerMinterProgram.eventAuthorityAddress(),
        };
    }

    async reclaimEventAccountIx(
        accounts: { payee: PublicKey; messageSentEventData: PublicKey },
        attestation: Buffer,
    ): Promise<TransactionInstruction> {
        const { payee, messageSentEventData } = accounts;
        return this.program.methods
            .reclaimEventAccount({ attestation })
            .accounts({
                payee,
                messageTransmitter: this.messageTransmitterConfigAddress(),
                messageSentEventData,
            })
            .instruction();
    }
}
