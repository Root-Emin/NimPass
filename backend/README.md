# Nimpass backend

Independent MIT-licensed Go/Chi/PostgreSQL backend for the Nimpass session-pass domain. The previous AGPL MasterFabric reference was moved outside this repository to the sibling `nimpass-masterfabric-reference` directory; no MasterFabric code is used here.

## Run

Set `DATABASE_URL` to a PostgreSQL database URL. `APP_ENV` is `development`, `test`, or `production`; `HTTP_ADDR` defaults to `:8080`; `NIMIQ_NETWORK` is `TESTNET` or `MAINNET`. `NIMIQ_RPC_URL` must point to a trusted, synced PoS JSON-RPC node on the same network. Startup refuses an RPC network mismatch; production RPC requires HTTPS. `PUBLIC_ORIGIN` must be the exact browser/Mini App frontend origin allowed to make credentialed requests. Production requires HTTPS and rejects `sslmode=disable`. Session cookies default to Secure; for local HTTP only, opt in explicitly with `SESSION_COOKIE_MODE=local-insecure` and a non-production `APP_ENV`. `.env.example` contains placeholders; the application does not automatically read `.env` files.

From `backend/`:

```sh
go run ./cmd/migrate
go run ./cmd/server
```

The server requires PostgreSQL and a network-matched RPC endpoint at startup. `GET /health/live` reports process health; `GET /health/ready` checks PostgreSQL. The versioned API contract is [openapi.yaml](openapi.yaml). Mission 02 implements authentication and catalog management. Mission 03 adds purchase intents, transaction verification, macro-block finality, background/manual reconciliation and atomic Pass creation. Redemption remains for Mission 04.

The frontend signs the exact `message` returned by `POST /api/v1/auth/challenges` or the payout challenge endpoint with Nimiq Pay `sign(message)` and sends the returned hex `publicKey` and `signature`. Payout verification additionally needs `ownerPublicKey` and `ownerSignature` from a fresh signature by the authenticated login wallet over that same message. The backend never accepts a client-reconstructed message or a claimed wallet without public-key binding. The Nimiq Mini App documentation specifies the response shape but not the precise host-side signing prehash/prefix semantics; the isolated `internal/nimiq` adapter currently verifies Ed25519 over the exact UTF-8 message bytes with no fallback. `go run ./cmd/verify-sign-fixture` can test a captured signature against one explicit scheme. A real Nimiq Pay WebView fixture remains a release blocker.

Authenticated browser requests use `credentials: 'include'`. Every unsafe method requires the configured Origin or Referer fallback; authenticated unsafe methods also require `X-CSRF-Token`, returned on login and `GET /api/v1/auth/session`. Responses are `Cache-Control: no-store`. Public discovery requires no wallet login.

## Test

```sh
go fmt ./...
go test ./...
go vet ./...
golangci-lint run ./...
npx --yes @redocly/cli lint openapi.yaml
```

For PostgreSQL integration tests, set `TEST_DATABASE_URL` to a disposable database whose name ends in `_test`, then run `go test ./...`. The tests create and drop only their own random schemas. No production database should be used for this test.

## Domain boundaries

`internal/domain` owns value objects and aggregates: Identity, Provider, Service, Package, Purchase, Pass, RedemptionChallenge, and Redemption. `internal/application` orchestrates authentication, catalog and payment use cases. `internal/nimiq` isolates address derivation, signing preprocessing and the real PoS JSON-RPC adapter. `internal/database` owns PostgreSQL repositories and forward-only, checksum-checked migrations. `internal/httpapi` owns transport DTOs and policy middleware.

Purchase confirmation requires exact transaction matching, main-chain inclusion and the next macro block on the main chain. Candidate hashes do not globally reserve payment ownership; the unique verified receipt, Purchase confirmation and Pass insert commit in one PostgreSQL transaction. Redemption has no HTTP flow yet; the signature verifier added for auth/payout can be reused there only with a separate redemption-specific challenge purpose and server-side state machine. Do not expose either transition directly to untrusted HTTP input.

The purchase intent TTL is 30 minutes. For fixed-expiration packages, new intents stop at `package.expires_at - 35 minutes` (TTL plus five-minute settlement grace); the cutoff does not change the package or an already-valid intent. Submitted or verifying payments are never automatically expired by the domain state machine; background or manual reconciliation settles them. An expired intent may use the five-minute settlement grace only if the backend observed the matching transaction in the mempool before expiry; submitting a hash alone is not broadcast proof. An expired intent cannot accept a new wallet submission. Package expiration currently stores an optional fixed UTC date and snapshots it into purchases and passes. Relative-duration expiration is not implemented.

If a matching payment is verified and macro-finalized only after its fixed package expiration prevents activation, the transaction atomically claims the unique verified receipt, records `COMPENSATION_REQUIRED` and an open compensation case, and creates no Pass. The API returns no further payment request and explicitly says not to pay again. The case persists reason, receipt, status, and future manual refund/reissue resolution metadata; there is no automatic refund or provider-key custody. The customer/provider remediation workflow itself is not implemented. The Mini App `sign()` preprocessor remains unproven without a live Nimiq Pay signature fixture. Mission 03 backend implementation is complete only after tests pass; release validation remains pending and this is not production/competition-ready.
