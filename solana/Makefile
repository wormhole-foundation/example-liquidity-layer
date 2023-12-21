SOLANA_CLI="v1.16.16"
ANCHOR_CLI="v0.28.0"

out_mainnet=artifacts-mainnet
out_testnet=artifacts-testnet
out_localnet=artifacts-localnet

.PHONY: all clean check build test lint ci

all: check

check:
	cargo check --all-features

clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules:
	npm ci

build: $(out_$(NETWORK))
$(out_$(NETWORK)):
ifdef out_$(NETWORK)
	anchor build -p token_router --arch sbf -- --features "$(NETWORK),no-idl" -- --no-default-features
	mkdir -p $(out_$(NETWORK))
	cp target/deploy/*.so $(out_$(NETWORK))/
endif

test: node_modules
	cargo test --all-features
	anchor build -p token_router --arch sbf -- --features testnet
	mkdir -p ts/tests/artifacts && cp target/deploy/token_router.so ts/tests/artifacts/testnet_token_router.so
	anchor build --arch sbf -- --features integration-test
	anchor test --skip-build

lint:
	cargo fmt --check
	cargo clippy --no-deps --all-targets --all-features -- -D warnings

ci:
	DOCKER_BUILDKIT=1 docker build -f Dockerfile.ci \
		--build-arg SOLANA_CLI=$(SOLANA_CLI) \
		--build-arg ANCHOR_CLI=$(ANCHOR_CLI) \
		.
