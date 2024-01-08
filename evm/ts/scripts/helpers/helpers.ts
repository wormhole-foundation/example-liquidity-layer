import * as fs from "fs";

export function getConfig(network: string) {
    const config = JSON.parse(
        fs.readFileSync(`${__dirname}/../../../cfg/deployment.${network}.json`, "utf8")
    );
    return config;
}
