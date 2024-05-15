import { deserializeLayout, encoding } from "@wormhole-foundation/sdk";
import { expect } from "chai";
import {
    fastMarketOrderLayout,
    fillLayout,
    slowOrderResponseLayout,
    cctpDepositLayout,
} from "../src/layouts";
const fillPayloads = [
    {
        header: "01000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000003b9aca000000000000000001000000000000e02200000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c10000000000000000000000002adf8b30d4dd24a05ccd9afbdc06a5b49c9c758d006401000200000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1000000000000000000000000ffcf8fdee72ac11b5c542428b35eef5769c409f0001f416c6c20796f75722062617365206172652062656c6f6e6720746f2075732e",
        fill: "01000200000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1000000000000000000000000ffcf8fdee72ac11b5c542428b35eef5769c409f0001f416c6c20796f75722062617365206172652062656c6f6e6720746f2075732e",
    },
];
describe("Fill Payload Tests", () => {
    it("Can deserialize a header", () => {
        const rawHeader = encoding.hex.decode(fillPayloads[0].header);
        const rawFill = encoding.hex.decode(fillPayloads[0].fill);

        const deserializedHeader = deserializeLayout(cctpDepositLayout, rawHeader);
        console.log(deserializedHeader);
        const equiv = encoding.bytes.equals(deserializedHeader.payload, rawFill);
        expect(equiv).to.be.true;

        const deserializedFill = deserializeLayout(fillLayout, rawFill);
        console.log(deserializedFill);
    });
});

const slowPayloads = [
    {
        header: "01000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000000000000000000000000000000000003b9aca000000000600000001000000000002455700000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c100000000000000000000000027d44c7337ce4d67b7cd573e9c36bdeed2b2162a00090200000000000186a0",
        slowResponse: "0200000000000186a0",
        fastMarketOrder:
            "0b000000003b9aca0000000000000000000002000000000000000000000000ffcf8fdee72ac11b5c542428b35eef5769c409f000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c100000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c10000000000970fe000000000000186a000000000001f416c6c20796f75722062617365206172652062656c6f6e6720746f2075732e",
    },
];

describe("Slow payload tests", () => {
    it("Can deserialize a header", () => {
        const rawHeader = encoding.hex.decode(slowPayloads[0].header);
        const rawSlowResponse = encoding.hex.decode(slowPayloads[0].slowResponse);
        const rawFastMarketOrder = encoding.hex.decode(slowPayloads[0].fastMarketOrder);

        const deserializedHeader = deserializeLayout(cctpDepositLayout, rawHeader);
        const equiv = encoding.bytes.equals(deserializedHeader.payload, rawSlowResponse);
        expect(equiv).to.be.true;

        const deserializedSlowResponse = deserializeLayout(
            slowOrderResponseLayout,
            rawSlowResponse,
        );
        console.log(deserializedSlowResponse);

        const deserializedFastMarketOrder = deserializeLayout(
            fastMarketOrderLayout,
            rawFastMarketOrder,
        );
        console.log(deserializedFastMarketOrder);
    });
});
