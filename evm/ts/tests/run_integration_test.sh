#/bin/bash

pgrep anvil > /dev/null
if [ $? -eq 0 ]; then
    echo "anvil already running"
    exit 1;
fi

. .env

ROOT=$(dirname $0)

LOGS=$ROOT/.anvil
mkdir -p $LOGS

# Avalanche (ME and CCTP).
anvil --port 8547 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --no-mining \
    --fork-url $AVALANCHE_RPC > $LOGS/avalanche.log &

# Ethereum (CCTP).
anvil --port 8548 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --no-mining \
    --fork-url $ETHEREUM_RPC > $LOGS/ethereum.log &

# BNB (Native).
anvil --port 8549 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --no-mining \
    --fork-url $BNB_RPC > $LOGS/bnb.log &

# Moonbeam (Canonical).
anvil --port 8550 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --no-mining \
    --fork-url $MOONBEAM_RPC > $LOGS/moonbeam.log &

sleep 5

# echo "running tests (found in ts/test)"
npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/*.ts

# nuke
pkill anvil