#!/bin/bash

while getopts ":n:c:k:t:a:" opt; do
  case $opt in
    n) network="$OPTARG"
    ;;
    c) chain="$OPTARG"
    ;;
    k) private_key="$OPTARG"
    ;;
    t) target_chain="$OPTARG"
    ;;
    a) address="$OPTARG"
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

if [ -z ${target_chain+x} ];
then
    echo "target chain (-t) is unset" >&2
    exit 1
fi

if [ -z ${address+x} ];
then
    echo "target address (-a) is unset" >&2
    exit 1
fi

export TARGET_CHAIN=$target_chain
export TARGET_ADDRESS=$address

set -euo pipefail

ROOT=$(dirname $0)
ENV=$ROOT/../env
FORGE_SCRIPTS=$ROOT/../forge/scripts

. $ENV/$network/$chain.env

forge script $FORGE_SCRIPTS/RegisterNativeSwap.s.sol \
    --rpc-url $RPC \
    --broadcast \
    --private-key $private_key \
    --gas-estimate-multiplier 200 \
    --tc RegisterNativeSwap