import { Connection, PublicKey } from "@solana/web3.js";
import { CircleContracts } from "@wormhole-foundation/sdk-base/contracts";
import { Program } from "anchor-0.29.0";
import { MessageTransmitterProgram } from "../messageTransmitter";
import { IDL, TokenMessengerMinter } from "../types/token_messenger_minter";
import { RemoteTokenMessenger } from "./RemoteTokenMessenger";

export type DepositForBurnWithCallerAccounts = {
    senderAuthority: PublicKey;
    messageTransmitterConfig: PublicKey;
    tokenMessenger: PublicKey;
    remoteTokenMessenger: PublicKey;
    tokenMinter: PublicKey;
    localToken: PublicKey;
    tokenMessengerMinterEventAuthority: PublicKey;
    messageTransmitterProgram: PublicKey;
    tokenMessengerMinterProgram: PublicKey;
};

export class TokenMessengerMinterProgram {
    program: Program<TokenMessengerMinter>;

    constructor(connection: Connection, private contracts: CircleContracts) {
        const programId = new PublicKey(contracts.tokenMessenger);
        this.program = new Program(IDL, programId, { connection });
    }

    get ID(): PublicKey {
        return this.program.programId;
    }

    tokenMessengerAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("token_messenger")], this.ID)[0];
    }

    tokenMinterAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("token_minter")], this.ID)[0];
    }

    custodyTokenAddress(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("custody"), mint.toBuffer()],
            this.ID,
        )[0];
    }

    tokenPairAddress(remoteDomain: number, remoteTokenAddress: Array<number>): PublicKey {
        return PublicKey.findProgramAddressSync(
            [
                Buffer.from("token_pair"),
                Buffer.from(remoteDomain.toString()),
                Buffer.from(remoteTokenAddress),
            ],
            this.ID,
        )[0];
    }

    remoteTokenMessengerAddress(remoteDomain: number): PublicKey {
        return RemoteTokenMessenger.address(this.ID, remoteDomain);
    }

    async fetchRemoteTokenMessenger(addr: PublicKey): Promise<RemoteTokenMessenger> {
        const { domain, tokenMessenger } = await this.program.account.remoteTokenMessenger.fetch(
            addr,
        );
        return new RemoteTokenMessenger(domain, Array.from(tokenMessenger.toBuffer()));
    }

    localTokenAddress(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from("local_token"), mint.toBuffer()],
            this.ID,
        )[0];
    }

    senderAuthorityAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("sender_authority")], this.ID)[0];
    }

    eventAuthorityAddress(): PublicKey {
        return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], this.ID)[0];
    }

    messageTransmitterProgram(): MessageTransmitterProgram {
        return new MessageTransmitterProgram(this.program.provider.connection, this.contracts);
    }

    depositForBurnWithCallerAccounts(
        mint: PublicKey,
        remoteDomain: number,
    ): DepositForBurnWithCallerAccounts {
        const messageTransmitterProgram = this.messageTransmitterProgram();
        return {
            senderAuthority: this.senderAuthorityAddress(),
            messageTransmitterConfig: messageTransmitterProgram.messageTransmitterConfigAddress(),
            tokenMessenger: this.tokenMessengerAddress(),
            remoteTokenMessenger: this.remoteTokenMessengerAddress(remoteDomain),
            tokenMinter: this.tokenMinterAddress(),
            localToken: this.localTokenAddress(mint),
            tokenMessengerMinterEventAuthority: this.eventAuthorityAddress(),
            messageTransmitterProgram: messageTransmitterProgram.ID,
            tokenMessengerMinterProgram: this.ID,
        };
    }
}
