
.PHONY: clean
clean:
	rm -rf node_modules
	cd solana && $(MAKE) clean

.PHONY: clean-install
clean-install: clean node_modules

node_modules:
	npm ci

.PHONY: build
build: node_modules
	npm run build:universal