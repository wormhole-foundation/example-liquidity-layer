BUILD_mainnet=artifacts-mainnet
BUILD_testnet=artifacts-testnet
BUILD_localnet=artifacts-localnet

SPY_NETWORK_mainnet=/wormhole/mainnet/2
SPY_BOOTSTRAP_mainnet="/dns4/wormhole-v2-mainnet-bootstrap.xlabs.xyz/udp/8999/quic/p2p/12D3KooWNQ9tVrcb64tw6bNs2CaNrUGPM7yRrKvBBheQ5yCyPHKC,/dns4/wormhole.mcf.rocks/udp/8999/quic/p2p/12D3KooWDZVv7BhZ8yFLkarNdaSWaB43D6UbQwExJ8nnGAEmfHcU,/dns4/wormhole-v2-mainnet-bootstrap.staking.fund/udp/8999/quic/p2p/12D3KooWG8obDX9DNi1KUwZNu9xkGwfKqTp2GFwuuHpWZ3nQruS1"

SPY_NETWORK_testnet=/wormhole/testnet/2/1
SPY_BOOTSTRAP_testnet="/dns4/t-guardian-01.nodes.stable.io/udp/8999/quic/p2p/12D3KooWCW3LGUtkCVkHZmVSZHzL3C4WRKWfqAiJPz1NR7dT9Bxh,/dns4/t-guardian-02.nodes.stable.io/udp/8999/quic/p2p/12D3KooWJXA6goBCiWM8ucjzc4jVUBSqL9Rri6UpjHbkMPErz5zK"

.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules: package-lock.json
	npm ci

.PHONY: cargo-test
cargo-test:
	cargo test --workspace --all-targets --features $(NETWORK)

.PHONY: build
build:
ifdef BUILD_$(NETWORK)
	mkdir $(BUILD_$(NETWORK)) # do not want to continue if the directory already exists
	anchor build --arch sbf -- --features $(NETWORK)
	cp target/deploy/*.so $(BUILD_$(NETWORK))/
endif

$(BUILD_$(NETWORK)): cargo-test

.PHONY: test
test: node_modules
	NETWORK=localnet $(MAKE) cargo-test
	NETWORK=testnet $(MAKE) cargo-test
	anchor build --arch sbf -- --features testnet
	mkdir -p ts/tests/artifacts
	cp target/deploy/matching_engine.so ts/tests/artifacts/testnet_matching_engine.so
	cp target/deploy/token_router.so ts/tests/artifacts/testnet_token_router.so
	cp target/deploy/upgrade_manager.so ts/tests/artifacts/testnet_upgrade_manager.so
	anchor build --arch sbf -- --features integration-test
	anchor test --skip-build

.PHONY: clippy
clippy:
	cargo clippy --workspace --no-deps --all-targets --features $(NETWORK) -- -Dwarnings

.PHONY: lint
lint:
	cargo fmt --check
	NETWORK=localnet $(MAKE) clippy
	NETWORK=testnet $(MAKE) clippy

.PHONY: run-spy
wormhole-spy:
ifdef SPY_NETWORK_$(NETWORK)
	docker run \
		--platform=linux/amd64 \
		-p 7073:7073 \
		--entrypoint /guardiand ghcr.io/wormhole-foundation/guardiand:latest spy \
		--nodeKey /node.key \
		--spyRPC "[::]:7073" \
		--network $(SPY_NETWORK_$(NETWORK)) \
		--bootstrap $(SPY_BOOTSTRAP_$(NETWORK))
endif