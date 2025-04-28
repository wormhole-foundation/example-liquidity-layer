BUILD_mainnet=artifacts-mainnet
BUILD_testnet=artifacts-testnet
BUILD_localnet=artifacts-localnet

CLONED_MAINNET_PROGRAMS=\
	ts/tests/artifacts/mainnet_core_bridge.so \
	ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so \
	ts/tests/artifacts/mainnet_cctp_message_transmitter.so

PROGRAM_NAMES=matching_engine token_router upgrade_manager

### Building the IDL requires a nightly build. We arbitrarily chose the same
### date as the release of Anchor 0.30.1.
IDL_TOOLCHAIN=nightly-2024-06-20

.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules:
	cd .. && $(MAKE) clean-install && $(MAKE) build

.PHONY: cargo-test
cargo-test:
	cargo test --workspace --all-targets --features $(NETWORK)

.PHONY: cargo-test-all
cargo-test-all:
	NETWORK=localnet $(MAKE) cargo-test
	NETWORK=testnet $(MAKE) cargo-test
	NETWORK=mainnet $(MAKE) cargo-test

.PHONY: build
build:
ifdef BUILD_$(NETWORK)
	mkdir $(BUILD_$(NETWORK)) # do not want to continue if the directory already exists
	anchor build --no-idl -- --features $(NETWORK)
	cp target/deploy/*.so $(BUILD_$(NETWORK))/
endif

.PHONY: anchor-test-setup
anchor-test-setup: node_modules ts/tests/artifacts $(CLONED_MAINNET_PROGRAMS)
	anchor build --no-idl -- --features integration-test

.PHONY: idl
idl:
	mkdir -p target/idl target/types
	for program in $(PROGRAM_NAMES); do \
		RUSTUP_TOOLCHAIN=$(IDL_TOOLCHAIN) anchor idl build -p $$program -o target/idl/$$program.json; \
		anchor idl type -o target/types/$$program.ts target/idl/$$program.json; \
	done
	mkdir -p ts/src/idl/json
	mkdir -p ts/src/idl/ts
	cp -r target/idl/* ts/src/idl/json/
	cp -r target/types/* ts/src/idl/ts/

.PHONY: check-idl
check-idl: idl
	git diff --exit-code

$(BUILD_$(NETWORK)): cargo-test

.PHONY: anchor-test
anchor-test: anchor-test-setup
	cp target/deploy/upgrade_manager.so ts/tests/artifacts/testnet_upgrade_manager.so
	bash sh/run_anchor_test.sh

.PHONY: anchor-test-upgrade
anchor-test-upgrade: node_modules ts/tests/artifacts $(CLONED_MAINNET_PROGRAMS)
	anchor build --no-idl -- --features testnet
	cp target/deploy/matching_engine.so ts/tests/artifacts/new_testnet_matching_engine.so
	cp target/deploy/token_router.so ts/tests/artifacts/new_testnet_token_router.so
	cp target/deploy/upgrade_manager.so ts/tests/artifacts/testnet_upgrade_manager.so
	bash sh/run_anchor_test_upgrade.sh

.PHONY: clippy
clippy:
	cargo clippy --workspace --no-deps --all-targets --features $(NETWORK) -- -Dwarnings

.PHONY: lint
lint:
	cargo fmt --check
	NETWORK=localnet $(MAKE) clippy
	NETWORK=testnet $(MAKE) clippy
	NETWORK=mainnet $(MAKE) clippy

ts/tests/artifacts:
	mkdir ts/tests/artifacts

ts/tests/artifacts/mainnet_core_bridge.so: ts/tests/artifacts
	solana program dump -u m worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth ts/tests/artifacts/mainnet_core_bridge.so

ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so: ts/tests/artifacts
	solana program dump -u m CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so

ts/tests/artifacts/mainnet_cctp_message_transmitter.so: ts/tests/artifacts
	solana program dump -u m CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd ts/tests/artifacts/mainnet_cctp_message_transmitter.so
