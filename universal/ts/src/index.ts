import { deserializeLayout, serializeLayout } from "@wormhole-foundation/sdk-base";
import {
    MessageName,
    MessageType,
    messageDiscriminator,
    messageLayout,
    messageNames,
    messages,
} from "./messages";
import {
    PayloadName,
    PayloadType,
    payloadDiscriminator,
    payloadLayout,
    payloadNames,
    payloads,
} from "./payloads";

export * from "./messages";
export * from "./payloads";

export namespace Message {
    // Type guard for message types
    export function is<N extends MessageName>(message: any, name: N): message is MessageType<N> {
        // Check that all items in the layout are represented in the message
        return messages(name).layout.filter((item) => !(item.name in message)).length === 0;
    }

    export function serialize(message: MessageType<MessageName>) {
        for (const name of messageNames)
            if (Message.is(message, name)) return serializeLayout(messageLayout(name), message);
        throw new Error("Unrecognized message type");
    }

    export function deserialize(message: Uint8Array): MessageType<MessageName> {
        const idx = messageDiscriminator(message);
        if (idx === null) throw new Error("Unrecognized message type");
        const name = messageNames[idx];
        return deserializeLayout(messageLayout(name), message);
    }
}

export namespace Payload {
    // Type guard for payload types
    export function is<N extends PayloadName>(payload: any, name: N): payload is PayloadType<N> {
        return payloads(name).layout.filter((item) => !(item.name in payload)).length === 0;
    }

    export function serialize(payload: PayloadType<PayloadName>) {
        for (const name of payloadNames)
            if (Payload.is(payload, name)) return serializeLayout(payloadLayout(name), payload);
        throw new Error("Unrecognized payload type");
    }

    export function deserialize(message: Uint8Array): PayloadType<PayloadName> {
        const idx = payloadDiscriminator(message);
        if (idx === null) throw new Error("Unrecognized payload type");
        const name = payloadNames[idx];
        return deserializeLayout(payloadLayout(name), message);
    }
}
