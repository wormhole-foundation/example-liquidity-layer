import { ethers } from "ethers";

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

  switch (selector) {
    case computeSelector("ErrZeroMinAmountOut()"): {
      return { selector: "ErrZeroMinAmountOut" };
    }
    case computeSelector("ErrUnsupportedChain(uint16)"): {
      return {
        selector: "ErrUnsupportedChain",
        data: "0x" + data.substring(10),
      };
    }
    case computeSelector("ErrInsufficientAmount(uint256,uint256)"): {
      return {
        selector: "ErrInsufficientAmount",
        data: "0x" + data.substring(10),
      };
    }
    case computeSelector("InvalidRelayerFee()"): {
      return { selector: "InvalidRelayerFee" };
    }
    default: {
      throw new Error(`unknown selector: ${selector}`);
    }
  }
}

function computeSelector(methodSignature: string): string {
  return ethers.utils.keccak256(Buffer.from(methodSignature)).substring(0, 10);
}