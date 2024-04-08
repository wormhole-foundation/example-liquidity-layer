// import {
//     ParsedVaaWithBytes,
//     StandardRelayerApp,
//     StandardRelayerContext,
//     fetchVaaHash,
// } from "@wormhole-foundation/relayer-engine";
// import * as winston from "winston";
// import { AppConfig } from ".";

// export async function fetchTxHashWithRetry(
//     cfg: AppConfig,
//     app: StandardRelayerApp<StandardRelayerContext>,
//     possibleTxHash: string,
//     vaa: ParsedVaaWithBytes,
//     logger: winston.Logger
// ): Promise<string | null> {
//     if (possibleTxHash !== "") {
//         return possibleTxHash;
//     }

//     const { maxRetries, retryBackoff } = cfg.sourceTxHash();

//     let txHash = "";
//     let txHashRetries = 0;
//     while (txHashRetries < maxRetries && txHash == "") {
//         const backoff = txHashRetries * retryBackoff;
//         logger.debug(
//             `Retrying sourceTxHash... ${txHashRetries} out of ${maxRetries} (waiting ${backoff}ms)`
//         );

//         await new Promise((resolve) => setTimeout(resolve, backoff));

//         txHash = await fetchVaaHash(
//             vaa.emitterChain,
//             vaa.emitterAddress,
//             vaa.sequence,
//             app.env,
//             logger
//         );

//         txHash ??= "";
//         ++txHashRetries;
//     }

//     return txHash == "" ? null : txHash;
// }
