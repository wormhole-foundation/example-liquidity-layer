#!/bin/bash

while getopts ":n:c:u:k:" opt; do
  case $opt in
    n) network="$OPTARG"
    ;;
    c) chain="$OPTARG"
    ;;
    k) private_key="$OPTARG"
    ;;
    \?) echo "Invalid option -$OPTARG" >&2
    exit 1
    ;;
  esac

  case $OPTARG in
    -*) echo "Option $opt needs a valid argument" >&2
    exit 1
    ;;
  esac
done

if [ -z ${network+x} ];
then
    echo "network (-n) is unset" >&2
    exit 1
fi

if [ -z ${chain+x} ];
then
    echo "chain (-c) is unset" >&2
    exit 1
fi

if [ -z ${private_key+x} ];
then
    echo "private key (-k) is unset" >&2
    exit 1
fi

set -euo pipefail

ROOT=$(dirname $0)
ENV=$ROOT/../env
TARGET=$ROOT/../ts/scripts/setup_matching_engine.ts

. $ENV/$network/$chain.env

npx ts-node $TARGET --network $network --chain $chain --rpc $RPC --key $private_key

