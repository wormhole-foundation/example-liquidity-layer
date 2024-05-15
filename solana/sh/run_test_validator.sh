#!/bin/bash

set -euo pipefail

if test -f .validator_pid; then
    echo "Killing existing validator"
    kill $(cat .validator_pid)
    rm .validator_pid
fi

rm -rf .anchor/test-ledger
mkdir -p .anchor

### Start up the validator.
echo "Starting solana-test-validator"

solana-test-validator \
    --ledger \
    .anchor/test-ledger \
    --mint \
    pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ \
    --bpf-program \
    TokenRouter11111111111111111111111111111111 \
    target/deploy/token_router.so \
    --bpf-program \
    MatchingEngine11111111111111111111111111111 \
    target/deploy/matching_engine.so \
    --bpf-program \
    UpgradeManager11111111111111111111111111111 \
    target/deploy/upgrade_manager.so \
    --bpf-program \
    worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth \
    ts/tests/artifacts/mainnet_core_bridge.so \
    --bpf-program \
    CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd \
    ts/tests/artifacts/mainnet_cctp_message_transmitter.so \
    --bpf-program \
    CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 \
    ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so \
    --clone-upgradeable-program \
    mPydpGUWxzERTNpyvTKdvS7v8kvw5sgwfiP8WQFrXVS \
    --clone-upgradeable-program \
    tD8RmtdcV7bzBeuFgyrFc8wvayj988ChccEzRQzo6md \
    --upgradeable-program \
    ucdP9ktgrXgEUnn6roqD2SfdGMR2JSiWHUKv23oXwxt \
    ts/tests/artifacts/testnet_upgrade_manager.so \
    pFCBP4bhqdSsrWUVTgqhPsLrfEdChBK17vgFM7TxjxQ \
    --account \
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
    ts/tests/accounts/usdc_mint.json \
    --account \
    4tKtuvtQ4TzkkrkESnRpbfSXCEZPkZe3eL5tCFUdpxtf \
    ts/tests/accounts/usdc_payer_token.json \
    --account \
    Afgq3BHEfCE7d78D2XE9Bfyu2ieDqvE24xX8KDwreBms \
    ts/tests/accounts/token_messenger_minter/token_messenger.json \
    --account \
    DBD8hAwLDRQkTsu6EqviaYNGKPnsAMmQonxf7AH8ZcFY \
    ts/tests/accounts/token_messenger_minter/token_minter.json \
    --account \
    FSxJ85FXVsXSr51SeWf9ciJWTcRnqKFSmBgRDeL3KyWw \
    ts/tests/accounts/token_messenger_minter/usdc_custody_token.json \
    --account \
    72bvEFk2Usi2uYc1SnaTNhBcQPc6tiJWXr9oKk7rkd4C \
    ts/tests/accounts/token_messenger_minter/usdc_local_token.json \
    --account \
    8d1jdvvMFhJfxSzPXcDGtifcGMTvUxc2EpWFstbNzcTL \
    ts/tests/accounts/token_messenger_minter/usdc_token_pair.json \
    --account \
    Hazwi3jFQtLKc2ughi7HFXPkpDeso7DQaMR9Ks4afh3j \
    ts/tests/accounts/token_messenger_minter/ethereum_remote_token_messenger.json \
    --account \
    REzxi9nX3Eqseha5fBiaJhTC6SFJx4qJhP83U4UCrtc \
    ts/tests/accounts/token_messenger_minter/arbitrum_remote_token_messenger.json \
    --account \
    BWyFzH6LsnmDAaDWbGsriQ9SiiKq1CF6pbH4Ye3kzSBV \
    ts/tests/accounts/token_messenger_minter/misconfigured_remote_token_messenger.json \
    --account \
    BWrwSWjbikT3H7qHAkUEbLmwDQoB4ZDJ4wcSEhSPTZCu \
    ts/tests/accounts/message_transmitter/message_transmitter_config.json \
    --account \
    2yVjuQwpsvdsrywzsJJVs9Ueh4zayyo5DYJbBNc3DDpn \
    ts/tests/accounts/core_bridge/config.json \
    --account \
    9bFNrXNb2WTx8fMHXCheaZqkLZ3YCCaiqTftHxeintHy \
    ts/tests/accounts/core_bridge/fee_collector.json \
    --account \
    DS7qfSAgYsonPpKoAjcGhX9VFjXdGkiHjEDkTidf8H2P \
    ts/tests/accounts/core_bridge/guardian_set_0.json \
    --account \
    5BsCKkzuZXLygduw6RorCqEB61AdzNkxp5VzQrFGzYWr \
    ts/tests/accounts/testnet/matching_engine_custodian.json \
    --account \
    CFYdtHYDnQgCAcwetWVjVg5V8Uiy1CpJaoYJxmV19Z7N \
    ts/tests/accounts/testnet/token_router_custodian.json \
    --bind-address \
    0.0.0.0 \
    --rpc-port \
    8899 \
    --ticks-per-slot \
    16 \
    --url \
    https://api.devnet.solana.com > /dev/null 2>&1 &

echo $! > .validator_pid