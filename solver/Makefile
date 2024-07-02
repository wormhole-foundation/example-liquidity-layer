SPY_NETWORK_mainnet=/wormhole/mainnet/2
SPY_BOOTSTRAP_mainnet="/dns4/wormhole-v2-mainnet-bootstrap.xlabs.xyz/udp/8999/quic/p2p/12D3KooWNQ9tVrcb64tw6bNs2CaNrUGPM7yRrKvBBheQ5yCyPHKC,/dns4/wormhole.mcf.rocks/udp/8999/quic/p2p/12D3KooWDZVv7BhZ8yFLkarNdaSWaB43D6UbQwExJ8nnGAEmfHcU,/dns4/wormhole-v2-mainnet-bootstrap.staking.fund/udp/8999/quic/p2p/12D3KooWG8obDX9DNi1KUwZNu9xkGwfKqTp2GFwuuHpWZ3nQruS1"

SPY_NETWORK_testnet=/wormhole/testnet/2/1
SPY_BOOTSTRAP_testnet="/dns4/t-guardian-01.testnet.xlabs.xyz/udp/8999/quic/p2p/12D3KooWCW3LGUtkCVkHZmVSZHzL3C4WRKWfqAiJPz1NR7dT9Bxh,/dns4/t-guardian-02.testnet.xlabs.xyz/udp/8999/quic/p2p/12D3KooWJXA6goBCiWM8ucjzc4jVUBSqL9Rri6UpjHbkMPErz5zK"

.PHONY: wormhole-spy-up
wormhole-spy-up:
ifdef SPY_NETWORK_$(NETWORK)
	WORMHOLE_NETWORK_ID=$(SPY_NETWORK_$(NETWORK)) \
	WORMHOLE_BOOTSTRAP=$(SPY_BOOTSTRAP_$(NETWORK)) \
	NATS_STREAM="${NETWORK}-vaas" \
	docker-compose -f docker-compose.yml up -d
endif

.PHONY: wormhole-spy-down
wormhole-spy-down:
	docker-compose -f docker-compose.yml down

.PHONY: wormhole-spy-restart
wormhole-spy-restart: wormhole-spy-down wormhole-spy-up
