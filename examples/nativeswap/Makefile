.PHONY: all unit-test integration-test build dependencies clean

all: build

.PHONY: build
build: dependencies
	forge build
	npm run build-types

.PHONY: dependencies
dependencies: node_modules lib/forge-std lib/openzeppelin-contracts

.PHONY: clean
clean:
	forge clean
	rm -rf node_modules anvil.log lib forge-scripts ts-types

node_modules:
	npm ci

lib/forge-std:
	forge install foundry-rs/forge-std@v1.6.1 --no-git --no-commit

lib/openzeppelin-contracts:
	forge install openzeppelin/openzeppelin-contracts@v4.8.1 --no-git --no-commit