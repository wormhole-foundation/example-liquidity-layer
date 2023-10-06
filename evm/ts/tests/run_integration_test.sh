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

# ethereum goerli testnet
# anvil \
#     -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
#     --port 8546 \
#     --fork-url $ETH_FORK_RPC > anvil_eth.log &

# Arbitrum.
anvil \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --port 8546 \
    --no-mining \
    --fork-url $ARBITRUM_RPC > $LOGS/arbitrum.log &

# Avalanche.
anvil \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --port 8547 \
    --no-mining \
    --fork-url $AVALANCHE_RPC > $LOGS/avalanche.log &

# Ethereum.
anvil \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --port 8548 \
    --no-mining \
    --fork-url $ETHEREUM_RPC > $LOGS/ethereum.log &

# Polygon.
anvil \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --port 8549 \
    --no-mining \
    --fork-url $POLYGON_RPC > $LOGS/polygon.log &

sleep 2

# echo "running tests (found in ts/test)"
npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/*.ts

# echo "running 'Circle Integration Send and Receive' again after upgrade"
# npx ts-mocha -t 1000000 ts/test/02_send_receive.ts

# nuke
pkill anvil