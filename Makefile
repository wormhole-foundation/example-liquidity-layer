
.PHONY: clean
clean:
	rm -rf node_modules
	npm run clean
	cd evm && $(MAKE) clean
	cd solana && $(MAKE) clean
	cd universal/rs && cargo clean

.PHONY: clean-install
clean-install: clean node_modules

node_modules:
	npm ci

.PHONY: build
build: node_modules
	npm run build:universal