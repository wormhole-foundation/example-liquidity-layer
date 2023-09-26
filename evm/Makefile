include env/testing.env

.PHONY: all test build dependencies clean

all: build

unit-test: build
	forge test --fork-url ${AVAX_RPC} -vv

build: dependencies
	forge build
	yarn build-types

dependencies: node_modules lib/forge-std lib/openzeppelin-contracts 

clean:
	forge clean
	rm -rf node_modules anvil.log lib forge-scripts ts-types


node_modules:
	yarn

lib/forge-std:
	forge install foundry-rs/forge-std@v1.6.1 --no-git --no-commit

lib/openzeppelin-contracts:
	forge install openzeppelin/openzeppelin-contracts@v4.8.1 --no-git --no-commit