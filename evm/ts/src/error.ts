import { ethers } from "ethers-v5";

export type DecodedErr = {
    selector: string;
    data?: string;
};

export function errorDecoder(ethersError: any): DecodedErr {
    if (
        !("code" in ethersError) ||
        !("error" in ethersError) ||
        !("error" in ethersError.error) ||
        !("error" in ethersError.error.error) ||
        !("code" in ethersError.error.error.error) ||
        !("data" in ethersError.error.error.error)
    ) {
        throw new Error("not contract error");
    }

    const { data } = ethersError.error.error.error as {
        data: string;
    };

    if (data.length < 10 || data.substring(0, 2) != "0x") {
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
    return ethers.utils.keccak256(Buffer.from(methodSignature)).substring(0, 10);
}
