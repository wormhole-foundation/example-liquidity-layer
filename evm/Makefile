include env/testing.env

.PHONY: all unit-test integration-test test build dependencies clean

all: build

.PHONY: unit-test
unit-test: build
	forge test --fork-url ${AVALANCHE_RPC} -vv

.PHONY: integration-test
integration-test: node_modules ts/tests/.env
	npm run generate 
	bash ts/tests/run_integration_test.sh

.PHONY: test
test: forge-test ts/tests/.env
	bash ts/tests/run_integration_test.sh

.PHONY: ts/tests/.env
ts/tests/.env:
	cp env/testing.env ts/tests/.env

.PHONY: forge-test
forge-test: dependencies
	forge test --fork-url ${AVALANCHE_RPC} -vv

.PHONY: build
build: dependencies
	forge build --skip test
	npm run generate 

.PHONY: dependencies
dependencies: node_modules

.PHONY: clean
clean:
	forge clean
	rm -rf anvil.log ts/src/types

node_modules: ../package-lock.json
	cd .. && npm ci
