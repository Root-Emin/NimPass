#!/usr/bin/env bash

# Local Nimiq Albatross Testnet node for Nimpass development.
#
# Nimpass never treats a wallet response or a client-reported hash as payment:
# the backend reads the chain itself (internal/nimiq/rpc.go). Without a synced
# Testnet node, a real phone payment is dispatched and then never verified — the
# purchase stays pending and no Pass is issued. This script runs that node.
#
# The node is a read-only window onto Testnet. It holds no wallet, no validator
# key and no funds, and its RPC is published on 127.0.0.1 only, so the phone and
# the rest of the LAN cannot reach it — only the Nimpass backend can.
#
# It is local development tooling, not a deployment: production needs its own
# trusted, synced RPC endpoint (see backend/README.md).
#
# Usage: ./scripts/testnet-node.sh [start|stop|status|logs|wait]

set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR="$ROOT_DIR/.nimpass-node"
CONTAINER="nimpass-testnet-node"
IMAGE="ghcr.io/nimiq/core-rs-albatross:latest"
RPC_URL="http://127.0.0.1:8648"

log() { printf '[nimpass-node] %s\n' "$*"; }
fail() { printf '[nimpass-node] ERROR: %s\n' "$*" >&2; exit 1; }

rpc() {
	# One JSON-RPC call. Prints the raw response, or nothing when the node is
	# not answering yet — callers decide what an empty answer means.
	curl -fsS --max-time 5 "$RPC_URL" \
		-H 'Content-Type: application/json' \
		--data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" 2>/dev/null || true
}

container_state() {
	docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || printf 'missing\n'
}

case "${1:-status}" in
start)
	command -v docker >/dev/null 2>&1 || fail "docker is required"
	docker info >/dev/null 2>&1 || fail "the Docker daemon is not running"
	[[ -f "$NODE_DIR/client.toml" ]] || fail "missing $NODE_DIR/client.toml"

	case "$(container_state)" in
	running)
		log "already running"
		;;
	missing)
		log "creating $CONTAINER from $IMAGE"
		docker run -d --name "$CONTAINER" \
			-v "$NODE_DIR:/home/nimiq/.nimiq" \
			-p 127.0.0.1:8648:8648 \
			"$IMAGE" >/dev/null
		;;
	*)
		log "starting existing $CONTAINER"
		docker start "$CONTAINER" >/dev/null
		;;
	esac
	log "RPC will answer on $RPC_URL once the node has synced"
	log "follow progress with: ./scripts/testnet-node.sh logs"
	;;

stop)
	[[ "$(container_state)" == missing ]] && { log "not created"; exit 0; }
	docker stop "$CONTAINER" >/dev/null
	# The chain database stays in .nimpass-node, so the next start resumes
	# instead of syncing the whole history again.
	log "stopped; chain data kept in .nimpass-node"
	;;

status)
	state="$(container_state)"
	log "container: $state"
	[[ "$state" == running ]] || exit 0
	network="$(rpc getNetworkId)"
	consensus="$(rpc isConsensusEstablished)"
	head="$(rpc getLatestBlock '[false]')"
	if [[ -z "$network" ]]; then
		log "RPC: not answering yet (the node is still starting or syncing)"
		exit 0
	fi
	log "network: $(printf '%s' "$network" | sed -n 's/.*"data":"\{0,1\}\([A-Za-z]*\)"\{0,1\}.*/\1/p')"
	if printf '%s' "$consensus" | grep -q '"data":true'; then
		log "consensus: established — the backend can verify payments"
	else
		log "consensus: not established yet — payments cannot be verified"
	fi
	log "head block: $(printf '%s' "$head" | sed -n 's/.*"number":\([0-9]*\).*/\1/p')"
	;;

wait)
	# Block until the node can actually answer the questions the backend asks.
	log "waiting for consensus (Ctrl+C to stop waiting; the node keeps syncing)"
	for _ in $(seq 1 720); do
		if printf '%s' "$(rpc isConsensusEstablished)" | grep -q '"data":true'; then
			log "consensus established"
			exit 0
		fi
		sleep 5
	done
	fail "consensus not established within an hour; check ./scripts/testnet-node.sh logs"
	;;

logs)
	docker logs -f --tail 40 "$CONTAINER"
	;;

*)
	fail "usage: ./scripts/testnet-node.sh [start|stop|status|logs|wait]"
	;;
esac
