include env/testing.env

.PHONY: all unit-test integration-test test build dependencies clean

all: build

.PHONY: unit-test
unit-test: build
	forge test --fork-url ${AVAX_RPC} -vv

#integration-test: ts/tests/.env build
.PHONY: integration-test
integration-test: node_modules ts/tests/.env
	bash ts/tests/run_integration_test.sh

.PHONY: test
test: node_modules ts/tests/.env
	forge test --fork-url ${AVAX_RPC} -vv
	bash ts/tests/run_integration_test.sh

.PHONY: build
build: dependencies
	forge build
	npm run build-types

.PHONY: dependencies
dependencies: node_modules lib/forge-std lib/openzeppelin-contracts

.PHONY: clean
clean:
	forge clean
	rm -rf node_modules anvil.log lib forge-scripts ts/src/types

node_modules:
	npm ci

lib/forge-std:
	forge install foundry-rs/forge-std@v1.6.1 --no-git --no-commit

lib/openzeppelin-contracts:
	forge install openzeppelin/openzeppelin-contracts@v4.8.1 --no-git --no-commit