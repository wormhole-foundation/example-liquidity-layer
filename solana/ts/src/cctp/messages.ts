import { CircleBridge, UniversalAddress } from "@wormhole-foundation/sdk-definitions";

export type Cctp = {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    nonce: bigint;
    sender: Array<number>;
    recipient: Array<number>;
    targetCaller: Array<number>;
};

// Taken from https://developers.circle.com/stablecoins/docs/message-format.
export class CctpMessage {
    cctp: Cctp;
    message: CctpTokenBurnMessage;

    constructor(cctp: Cctp, message: CctpTokenBurnMessage) {
        this.cctp = cctp;
        this.message = message;
    }

    static from(message: CctpMessage | Buffer): CctpMessage {
        if (message instanceof CctpMessage) {
            return message;
        } else {
            return CctpMessage.decode(message);
        }
    }

    static decode(buf: Readonly<Buffer>): CctpMessage {
        const version = buf.readUInt32BE(0);

        const [msg] = CircleBridge.deserialize(new Uint8Array(buf));
        const {
            sourceDomain,
            destinationDomain,
            nonce,
            sender,
            recipient,
            destinationCaller,
            payload,
        } = msg;

        const { burnToken, mintRecipient, amount, messageSender } = payload;
        const header: Cctp = {
            version,
            sourceDomain,
            destinationDomain,
            nonce,
            sender: Array.from(sender.toUint8Array()),
            recipient: Array.from(recipient.toUint8Array()),
            targetCaller: Array.from(destinationCaller.toUint8Array()),
        };

        return new CctpMessage(
            header,
            new CctpTokenBurnMessage(
                header,
                version,
                Array.from(burnToken.toUint8Array()),
                Array.from(mintRecipient.toUint8Array()),
                amount,
                Array.from(messageSender.toUint8Array()),
            ),
        );
    }

    encode(): Buffer {
        const { cctp, message } = this;
        return Buffer.from(
            CircleBridge.serialize({
                sourceDomain: cctp.sourceDomain,
                destinationDomain: cctp.destinationDomain,
                nonce: cctp.nonce,
                sender: new UniversalAddress(new Uint8Array(cctp.sender)),
                recipient: new UniversalAddress(new Uint8Array(cctp.recipient)),
                destinationCaller: new UniversalAddress(new Uint8Array(cctp.targetCaller)),
                payload: {
                    burnToken: new UniversalAddress(new Uint8Array(message.burnTokenAddress)),
                    mintRecipient: new UniversalAddress(new Uint8Array(message.mintRecipient)),
                    amount: message.amount,
                    messageSender: new UniversalAddress(new Uint8Array(message.sender)),
                },
            }),
        );
    }
}

export class CctpTokenBurnMessage {
    cctp: Cctp;
    version: number;
    burnTokenAddress: Array<number>;
    mintRecipient: Array<number>;
    amount: bigint;
    sender: Array<number>;

    constructor(
        cctp: Cctp,
        version: number,
        burnTokenAddress: Array<number>,
        mintRecipient: Array<number>,
        amount: bigint,
        sender: Array<number>,
    ) {
        this.cctp = cctp;
        this.version = version;
        this.burnTokenAddress = burnTokenAddress;
        this.mintRecipient = mintRecipient;
        this.amount = amount;
        this.sender = sender;
    }

    static from(message: CctpTokenBurnMessage | Buffer): CctpTokenBurnMessage {
        if (message instanceof CctpTokenBurnMessage) {
            return message;
        } else {
            return CctpTokenBurnMessage.decode(message);
        }
    }

    static decode(buf: Readonly<Buffer>): CctpTokenBurnMessage {
        const { message } = CctpMessage.decode(buf);
        return message;
    }

    encode(): Buffer {
        return new CctpMessage(this.cctp, this).encode();
    }
}
