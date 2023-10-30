#/bin/bash

pgrep anvil > /dev/null
if [ $? -eq 0 ]; then
    echo "anvil already running"
    exit 1;
fi

ROOT=$(dirname $0)

. $ROOT/.env

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

# Chill.
sleep 2

# Double-check number of anvil instances.
if [ "$( pgrep anvil | wc -l )" -ne 2 ]; then
    echo "Not all anvil instances are running. Try again."
    pkill anvil
    exit 1
fi

npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json  $ROOT/[0-9]*.ts

# Nuke.
pkill anvil