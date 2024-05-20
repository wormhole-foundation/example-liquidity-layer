import fetch from "node-fetch";
import * as winston from "winston";
import { AppConfig } from "./config";

interface VaaId {
    chain: number;
    sequence: number;
    emitter: string;
}

interface VaaResponse {
    vaa?: Buffer;
    txHash?: string;
}

export async function fetchVaaFromWormscan(
    cfg: AppConfig,
    vaaId: VaaId,
    logger: winston.Logger,
): Promise<VaaResponse> {
    const wormscanRequest = `${cfg.wormholeScanVaaEndpoint()}${vaaId.chain}/${vaaId.emitter}/${
        vaaId.sequence
    }`;

    const { maxRetries, retryBackoff } = cfg.sourceTxHash();

    let vaaResponse: VaaResponse = {};
    let retries = 0;
    while (
        vaaResponse.txHash == undefined &&
        vaaResponse.vaa == undefined &&
        retries < maxRetries
    ) {
        const backoff = retries * retryBackoff;
        logger.debug(
            `Requesting VaaResponse from Wormscan, retries=${retries}, maxRetries=${maxRetries}`,
        );

        await new Promise((resolve) => setTimeout(resolve, backoff));

        const response = await fetch(wormscanRequest);
        const parsedResponse = await response.json();
        vaaResponse.txHash = "0x" + parsedResponse.data.txHash;
        vaaResponse.vaa = Buffer.from(parsedResponse.data.vaa, "base64");

        ++retries;
    }

    return vaaResponse;
}
