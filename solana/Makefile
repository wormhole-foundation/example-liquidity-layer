out_mainnet=artifacts-mainnet
out_testnet=artifacts-testnet
out_localnet=artifacts-localnet

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
ifdef out_$(NETWORK)
	mkdir $(out_$(NETWORK)) # do not want to continue if the directory already exists
	anchor build --arch sbf -- --features $(NETWORK)
	cp target/deploy/*.so $(out_$(NETWORK))/
endif

$(out_$(NETWORK)): cargo-test

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