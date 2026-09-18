#!/usr/bin/env bash

# Start a local Nimpass backend that is safe for Nimiq Pay Testnet testing.
#
# The script runs migrations first and then replaces itself with the server.
# It deliberately refuses MAINNET and production so a copied development
# command cannot accidentally point a local WebView test at real funds.

set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT_DIR"

# Keep local credentials and endpoints out of git. The file is ignored by the
# repository's backend/.gitignore; copy .env.example and edit it first.
LOCAL_ENV="${NIMPASS_ENV_FILE:-$ROOT_DIR/.env.testnet.local}"
if [[ -f "$LOCAL_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$LOCAL_ENV"
  set +a
fi

export APP_ENV="${APP_ENV:-development}"
export NIMIQ_NETWORK="${NIMIQ_NETWORK:-TESTNET}"
export SESSION_COOKIE_MODE="${SESSION_COOKIE_MODE:-local-insecure}"
export NIMIQ_SIGNING_SCHEME="${NIMIQ_SIGNING_SCHEME:-raw}"
export HTTP_ADDR="${HTTP_ADDR:-:8080}"
export MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT_DIR/migrations}"
export MEDIA_DIR="${MEDIA_DIR:-$ROOT_DIR/var/media}"
mkdir -p "$MEDIA_DIR"

if [[ "$APP_ENV" == "production" ]]; then
  echo "Refusing to start production from start-testnet.sh" >&2
  exit 1
fi
if [[ "$NIMIQ_NETWORK" != "TESTNET" ]]; then
  echo "NIMIQ_NETWORK must be TESTNET for this script" >&2
  exit 1
fi

: "${DATABASE_URL:?Set DATABASE_URL to a disposable PostgreSQL database (name it *_test for local testing)}"
: "${NIMIQ_RPC_URL:?Set NIMIQ_RPC_URL to a trusted, synced Testnet RPC endpoint}"
: "${PUBLIC_ORIGIN:?Set PUBLIC_ORIGIN to the frontend origin, for example http://192.168.1.42:5173}"

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to run the backend" >&2
  exit 1
fi

echo "Applying Nimpass migrations to the configured Testnet database..."
go run ./cmd/migrate

echo "Starting Nimpass Testnet backend on $HTTP_ADDR"
exec go run ./cmd/server
