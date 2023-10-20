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

# Chill.
sleep 2

# Double-check number of anvil instances.
if [ "$( pgrep anvil | wc -l )" -ne 4 ]; then
    echo "Not all anvil instances are running. Try again."
    pkill anvil
    exit 1
fi

npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/[0-9]*.ts
# npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/00_*.ts
# npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/05__*.ts
# npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/10__*.ts
#npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/12__*.ts
#npx ts-mocha -t 1000000 -p $ROOT/tsconfig.json $ROOT/14__*.ts


# Nuke.
pkill anvil