import { encoding } from "@wormhole-foundation/sdk-base";
import { keccak256 } from "@wormhole-foundation/sdk-definitions";
import { isError } from "ethers";

export type DecodedErr = {
    selector: string;
    data?: string;
};

export function errorDecoder(ethersError: any): DecodedErr {
    if (!isError(ethersError, "CALL_EXCEPTION")) throw new Error("not a CALL_EXCEPTION error");

    const { data } = ethersError;

    if (!data || data.length < 10 || data.substring(0, 2) != "0x") {
        throw new Error("data not custom error");
    }

    const selector = data.substring(0, 10);

    // TODO: implement all errors
    switch (selector) {
        case computeSelector("ErrDeadlineExceeded()"): {
            return { selector: "ErrDeadlineExceeded" };
        }
        case computeSelector("ErrUnsupportedChain(uint16)"): {
            return {
                selector: "ErrUnsupportedChain",
                data: "0x" + data.substring(10),
            };
        }
        case computeSelector("ErrInvalidSourceRouter(bytes32,bytes32)"): {
            return {
                selector: "ErrInvalidSourceRouter",
                data: "0x" + data.substring(10),
            };
        }
        default: {
            throw new Error(`unknown selector: ${selector}`);
        }
    }
}

function computeSelector(methodSignature: string): string {
    return encoding.hex
        .encode(keccak256(encoding.bytes.encode(methodSignature)), true)
        .substring(0, 10);
}
