import { ChainId, tryHexToNativeString } from "@certusone/wormhole-sdk";
import { VaaSpy } from "../src/wormhole/spy";

async function main() {
    console.log("init spy");

    const spy = new VaaSpy({
        spyHost: "localhost:7073",
        vaaFilters: [
            {
                chain: "pythnet",
                // nativeAddress: "BwDNn2qvZc6drt8Q4zRE2HHys64ZyPXhWxt51ADtWuc1",
                nativeAddress: "G9LV2mp9ua1znRAfYwZz5cPiJMAbo1T6mbjdQsDZuMJg",
            },
        ],
        enableCleanup: true,
        seenThresholdMs: 5_000,
        intervalMs: 250,
        maxToRemove: 5,
    });

    spy.onObservation(({ raw, parsed, chain, nativeAddress }) => {
        console.log(
            "observed",
            parsed.emitterChain,
            chain,
            nativeAddress,
            tryHexToNativeString(
                parsed.emitterAddress.toString("hex"),
                parsed.emitterChain as ChainId,
            ),
            parsed.sequence,
        );
    });
}

// Do it.
main();
