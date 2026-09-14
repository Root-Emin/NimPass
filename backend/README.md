# Nimpass backend

Independent MIT-licensed Go/Chi/PostgreSQL backend for the Nimpass session-pass domain. The previous AGPL MasterFabric reference was moved outside this repository to the sibling `nimpass-masterfabric-reference` directory; no MasterFabric code is used here.

## Run

Set `DATABASE_URL` to a PostgreSQL database URL and explicitly set `APP_ENV` to `development`, `test`, or `production` and `NIMIQ_NETWORK` to `TESTNET` or `MAINNET`; missing environment or network values are rejected by both server and migrator. `HTTP_ADDR` defaults to `:8080`. `NIMIQ_RPC_URL` must point to a trusted, synced PoS JSON-RPC node on the same network. Startup refuses an RPC network mismatch; production RPC requires HTTPS. `PUBLIC_ORIGIN` must be the exact browser/Mini App frontend origin allowed to make credentialed requests. Production requires HTTPS and rejects `sslmode=disable`. Session cookies default to Secure; for local HTTP only, opt in explicitly with `SESSION_COOKIE_MODE=local-insecure` and a non-production `APP_ENV`. `TRUSTED_PROXY_CIDRS` is an optional comma-separated list; forwarded client IP headers are ignored unless the direct peer belongs to one of these CIDRs. `.env.example` contains placeholders; the application does not automatically read `.env` files.

From `backend/`:

```sh
go run ./cmd/migrate
go run ./cmd/server
```

The server requires PostgreSQL and a configured RPC URL. It rejects a reachable RPC network mismatch or malformed response at startup; a temporary RPC outage is logged and payment reconciliation retries while public reads remain available. `GET /health/live` reports process health; `GET /health/ready` checks PostgreSQL. The versioned API contract is [openapi.yaml](openapi.yaml). Mission 02 implements authentication and catalog management. Mission 03 adds purchase intents, transaction verification, macro-block finality, background/manual reconciliation and atomic Pass creation. Mission 04 adds customer-signed redemption challenges, opaque short-lived redemption references, provider lookup, explicit provider confirmation, atomic one-session consumption and customer/provider history. The HTTP server has bounded headers/body handling, production security headers, sanitized correlation IDs and explicit read/write/idle timeouts.

The frontend signs the exact `message` returned by `POST /api/v1/auth/challenges` or the payout/redemption challenge endpoint with Nimiq Pay `sign(message)` and sends the returned hex `publicKey` and `signature`. Payout verification additionally needs `ownerPublicKey` and `ownerSignature` from a fresh signature by the authenticated login wallet over that same message. The backend never accepts a client-reconstructed message or a claimed wallet without public-key binding. The Nimiq Mini App documentation specifies the response shape but not the precise host-side signing prehash/prefix semantics; the isolated `internal/nimiq` adapter currently verifies Ed25519 over the exact UTF-8 message bytes with no production fallback. `go run ./cmd/verify-sign-fixture -message "$MESSAGE" -wallet "$WALLET" -public-key "$PUBLIC_KEY" -signature "$SIGNATURE"` verifies a captured fixture with the one production scheme. A fixture consists of exactly `wallet`, `message`, `publicKey`, `signature`, and expected `verified` result; it never contains a private key. A real Nimiq Pay WebView fixture remains a release blocker.

Authenticated browser requests use `credentials: 'include'`. Every unsafe method requires the configured Origin or Referer fallback; authenticated unsafe methods also require `X-CSRF-Token`, returned on login and `GET /api/v1/auth/session`. Responses are `Cache-Control: no-store`. Public discovery requires no wallet login.

The API uses exact-origin credentialed CORS only. Security responses include `nosniff`, `no-referrer`, `DENY` framing, a backend-only CSP, a restrictive Permissions-Policy, and HSTS in production. Request IDs are server-generated unless a bounded safe correlation value is supplied; CR/LF and oversized values are discarded. Rate limiting is process-local and therefore suitable for the single-instance competition deployment only; it is not presented as distributed protection.

## Test

```sh
go fmt ./...
go test ./...
go vet ./...
golangci-lint run ./...
npx --yes @redocly/cli lint openapi.yaml
git diff --check
```

For PostgreSQL integration tests, set `TEST_DATABASE_URL` to a disposable database whose name ends in `_test`, then run `go test ./...`. The tests create and drop only their own random schemas. No production database should be used for this test.

## Domain boundaries

`internal/domain` owns value objects and aggregates: Identity, Provider, Service, Package, Purchase, Pass, RedemptionChallenge, and Redemption. `internal/application` orchestrates authentication, catalog and payment use cases. `internal/nimiq` isolates address derivation, signing preprocessing and the real PoS JSON-RPC adapter. `internal/database` owns PostgreSQL repositories and forward-only, checksum-checked migrations. `internal/httpapi` owns transport DTOs and policy middleware.

Purchase confirmation requires exact transaction matching, main-chain inclusion and the next macro block on the main chain. Candidate hashes do not globally reserve payment ownership; the unique verified receipt, Purchase confirmation and Pass insert commit in one PostgreSQL transaction. Redemption uses `POST /api/v1/passes/{passID}/redemption-challenges`, `GET /api/v1/passes/{passID}/redemption-challenges/current`, customer `AUTHORIZE_REDEMPTION` signing, `POST /api/v1/redemption-challenges/{challengeID}/authorization`, provider-owned `POST /api/v1/providers/{providerID}/redemptions/lookup`, then explicit `POST /api/v1/providers/{providerID}/redemptions/confirm`. Lookup is non-consuming and returns only safe service/package/session context; only the explicit confirm consumes a session. The reference is `NR1:<64 lowercase hex characters>`; only its SHA-256 digest is stored and a rotated reference invalidates the previous one. Provider lookup and confirmation require the authenticated provider session and never trust reference possession alone. Redemption, Pass updates, challenge consumption and audit events commit in one PostgreSQL transaction. Redemption history is available through the customer Pass and provider history endpoints. Live Nimiq Pay sign() interoperability remains a release blocker.

The purchase intent TTL is 30 minutes. For fixed-expiration packages, new intents stop at `package.expires_at - 35 minutes` (TTL plus five-minute settlement grace); the cutoff does not change the package or an already-valid intent. Submitted or verifying payments are never automatically expired by the domain state machine; background or manual reconciliation settles them. An expired intent may use the five-minute settlement grace only if the backend observed the matching transaction in the mempool before expiry; submitting a hash alone is not broadcast proof. An expired intent cannot accept a new wallet submission. Package expiration currently stores an optional fixed UTC date and snapshots it into purchases and passes. Relative-duration expiration is not implemented.

If a matching payment is verified and macro-finalized only after its fixed package expiration prevents activation, the transaction atomically claims the unique verified receipt, records `COMPENSATION_REQUIRED` and an open compensation case, and creates no Pass. The API returns no further payment request and explicitly says not to pay again. The case persists reason, receipt, status, and future manual refund/reissue resolution metadata; there is no automatic refund or provider-key custody. The customer/provider remediation workflow itself is not implemented. The Mini App `sign()` preprocessor remains unproven without a live Nimiq Pay signature fixture. Mission 03 backend implementation is complete only after tests pass; release validation remains pending and this is not production/competition-ready.

## PostgreSQL integration tests

The integration tests require a disposable PostgreSQL database whose name ends in `_test`. The test packages create an isolated random schema and apply the forward-only migrations automatically; they do not alter the public schema.

Example portable local run:

```sh
PG_DIR="$(mktemp -d /tmp/nimpass-pg.XXXXXX)"
initdb -D "$PG_DIR" -A trust --no-locale
pg_ctl -D "$PG_DIR" -o "-p 55441" -l "$PG_DIR/server.log" start
createdb -h 127.0.0.1 -p 55441 nimpass_test
TEST_DATABASE_URL="postgres://127.0.0.1:55441/nimpass_test?sslmode=disable" go test -count=1 ./...
TEST_DATABASE_URL="postgres://127.0.0.1:55441/nimpass_test?sslmode=disable" go test -count=1 -race ./...
pg_ctl -D "$PG_DIR" stop -m fast
rm -rf "$PG_DIR"
```

For a normal application database, set `DATABASE_URL` and run `go run ./cmd/migrate`. CI can provide `TEST_DATABASE_URL` from its PostgreSQL service instead of starting a local instance.

## Live Testnet harness

`cmd/live-testnet-harness` is an explicit, production-path validation tool. It refuses `MAINNET`, requires `LIVE_TESTNET_CONFIRM=YES`, uses no fake RPC/verifier, and never creates or receives a private key. It is intentionally split into operator-controlled phases because wallet payment and `sign()` require Nimiq Pay approval.

Use customer session/CSRF values from an authenticated Testnet session and provider session/CSRF values from an authenticated provider session. `NIMPASS_API_ORIGIN` and `NIMPASS_PUBLIC_ORIGIN` must match the deployed backend/frontend configuration.

```sh
export LIVE_TESTNET_CONFIRM=YES
export NIMIQ_NETWORK=TESTNET
export NIMPASS_API_ORIGIN=https://api.example.test
export NIMPASS_PUBLIC_ORIGIN=https://app.example.test
export NIMPASS_CUSTOMER_SESSION=...
export NIMPASS_CUSTOMER_CSRF=...
export NIMPASS_PACKAGE_ID=...
go run ./cmd/live-testnet-harness -phase intent

export NIMPASS_PURCHASE_ID=...
export NIMPASS_TX_HASH=...
go run ./cmd/live-testnet-harness -phase submit

export NIMPASS_PASS_ID=...
go run ./cmd/live-testnet-harness -phase challenge
```

Capture the exact printed challenge `message` in Nimiq Pay, then use the fixture CLI or the Mini App response values. Continue with `authorize` using `NIMPASS_CHALLENGE_ID`, `NIMPASS_PUBLIC_KEY`, and `NIMPASS_SIGNATURE`. Then set provider credentials and run `lookup` before `confirm`:

```sh
export NIMPASS_CHALLENGE_ID=...
export NIMPASS_PUBLIC_KEY=...
export NIMPASS_SIGNATURE=...
go run ./cmd/live-testnet-harness -phase authorize

export NIMPASS_PROVIDER_SESSION=...
export NIMPASS_PROVIDER_CSRF=...
export NIMPASS_PROVIDER_ID=...
export NIMPASS_REDEMPTION_REFERENCE=NR1:...
go run ./cmd/live-testnet-harness -phase lookup
go run ./cmd/live-testnet-harness -phase confirm
```

The expected terminal state is a successful authoritative confirmation, `remainingSessions` decreased by one, and a history item visible through both customer and provider history endpoints. A compensation response, expired/stale reference, or RPC uncertainty must stop the run and must never trigger a second payment.

## Operations and recovery

Run forward-only migrations before each rollout with `go run ./cmd/migrate`; the migration runner uses a PostgreSQL transaction, checksum verification, and an advisory lock. Take PostgreSQL backups according to the deployment provider's schedule and test restores in an isolated database before release. Restore the database and secrets through the deployment system, then run migrations; never store database credentials, session secrets, wallet keys, or raw captured signatures in backup documentation. Do not reset or rewrite a production database as a normal recovery step.

Readiness checks PostgreSQL connectivity only. Temporary Nimiq RPC failure leaves public reads available while payment reconciliation remains retryable through the background worker or manual reconciliation endpoint. Public catalog, purchase, provider history, and customer history queries are bounded to 100 records per response in the current compatibility-preserving contract; pagination can be added later as a coordinated API change.
