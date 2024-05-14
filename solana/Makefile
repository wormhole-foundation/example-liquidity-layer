BUILD_mainnet=artifacts-mainnet
BUILD_testnet=artifacts-testnet
BUILD_localnet=artifacts-localnet

SPY_NETWORK_mainnet=/wormhole/mainnet/2
SPY_BOOTSTRAP_mainnet="/dns4/wormhole-v2-mainnet-bootstrap.xlabs.xyz/udp/8999/quic/p2p/12D3KooWNQ9tVrcb64tw6bNs2CaNrUGPM7yRrKvBBheQ5yCyPHKC,/dns4/wormhole.mcf.rocks/udp/8999/quic/p2p/12D3KooWDZVv7BhZ8yFLkarNdaSWaB43D6UbQwExJ8nnGAEmfHcU,/dns4/wormhole-v2-mainnet-bootstrap.staking.fund/udp/8999/quic/p2p/12D3KooWG8obDX9DNi1KUwZNu9xkGwfKqTp2GFwuuHpWZ3nQruS1"

SPY_NETWORK_testnet=/wormhole/testnet/2/1
SPY_BOOTSTRAP_testnet="/dns4/t-guardian-01.nodes.stable.io/udp/8999/quic/p2p/12D3KooWCW3LGUtkCVkHZmVSZHzL3C4WRKWfqAiJPz1NR7dT9Bxh,/dns4/t-guardian-02.nodes.stable.io/udp/8999/quic/p2p/12D3KooWJXA6goBCiWM8ucjzc4jVUBSqL9Rri6UpjHbkMPErz5zK"

CLONED_MAINNET_PROGRAMS=\
	ts/tests/artifacts/mainnet_core_bridge.so \
	ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so \
	ts/tests/artifacts/mainnet_cctp_message_transmitter.so

.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules: ../node_modules
	cd .. && npm ci

.PHONY: cargo-test
cargo-test:
	cargo test --workspace --all-targets --features $(NETWORK)

.PHONY: cargo-test-all
cargo-test-all:
	NETWORK=localnet $(MAKE) cargo-test
	NETWORK=testnet $(MAKE) cargo-test

.PHONY: build
build:
ifdef BUILD_$(NETWORK)
	mkdir $(BUILD_$(NETWORK)) # do not want to continue if the directory already exists
	anchor build --no-idl -- --features $(NETWORK)
	cp target/deploy/*.so $(BUILD_$(NETWORK))/
endif

.PHONY: anchor-test-setup
anchor-test-setup: node_modules ts/tests/artifacts $(CLONED_MAINNET_PROGRAMS)
	anchor build --no-idl -- --features testnet
	cp target/deploy/matching_engine.so ts/tests/artifacts/new_testnet_matching_engine.so
	cp target/deploy/token_router.so ts/tests/artifacts/new_testnet_token_router.so
	cp target/deploy/upgrade_manager.so ts/tests/artifacts/testnet_upgrade_manager.so
	anchor build -- --features integration-test

.PHONY: idl
idl:
	anchor build -- --features localnet
	mkdir -p ts/src/idl/json
	mkdir -p ts/src/idl/ts
	cp -r target/idl/* ts/src/idl/json/
	cp -r target/types/* ts/src/idl/ts/
	git diff --exit-code

$(BUILD_$(NETWORK)): cargo-test

.PHONY: anchor-test
anchor-test: anchor-test-setup
	bash sh/run_anchor_test.sh

.PHONY: clippy
clippy:
	cargo clippy --workspace --no-deps --all-targets --features $(NETWORK) -- -Dwarnings

.PHONY: lint
lint:
	cargo fmt --check
	NETWORK=localnet $(MAKE) clippy
	NETWORK=testnet $(MAKE) clippy

.PHONY: wormhole-spy-up
wormhole-spy-up:
ifdef SPY_NETWORK_$(NETWORK)
	WORMHOLE_NETWORK_ID=$(SPY_NETWORK_$(NETWORK)) \
	WORMHOLE_BOOTSTRAP=$(SPY_BOOTSTRAP_$(NETWORK)) \
	NATS_STREAM="${NETWORK}-vaas" \
	docker-compose -f docker-compose.yml up -d
endif

.PHONY: wormhole-spy-down
wormhole-spy-down:
	docker-compose -f docker-compose.yml down

.PHONY: wormhole-spy-restart
wormhole-spy-restart: wormhole-spy-down wormhole-spy-up

ts/tests/artifacts:
	mkdir ts/tests/artifacts

ts/tests/artifacts/mainnet_core_bridge.so: ts/tests/artifacts
	solana program dump -u m worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth ts/tests/artifacts/mainnet_core_bridge.so

ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so: ts/tests/artifacts
	solana program dump -u m CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so

ts/tests/artifacts/mainnet_cctp_message_transmitter.so: ts/tests/artifacts
	solana program dump -u m CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd ts/tests/artifacts/mainnet_cctp_message_transmitter.so
