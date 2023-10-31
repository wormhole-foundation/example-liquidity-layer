import * as fs from "fs";

export function getConfig(network: string, configName: string) {
  const config = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../cfg/${configName}.${network}.json`,
      "utf8"
    )
  );
  return config;
}
