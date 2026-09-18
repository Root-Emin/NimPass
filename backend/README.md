# Nimpass backend

Independent MIT-licensed Go/Chi/PostgreSQL backend for the Nimpass session-pass domain. The previous AGPL MasterFabric reference was moved outside this repository to the sibling `nimpass-masterfabric-reference` directory; no MasterFabric code is used here.

## Run

Set `DATABASE_URL` to a PostgreSQL database URL and explicitly set `APP_ENV` to `development`, `test`, or `production` and `NIMIQ_NETWORK` to `TESTNET` or `MAINNET`; missing environment or network values are rejected by both server and migrator. `HTTP_ADDR` defaults to `:8080`. `NIMIQ_RPC_URL` must point to a trusted, synced PoS JSON-RPC node on the same network. Startup refuses an RPC network mismatch; production RPC requires HTTPS. `PUBLIC_ORIGIN` must be the exact browser/Mini App frontend origin allowed to make credentialed requests. Production requires HTTPS and an explicit database `sslmode=require`, `verify-ca`, or `verify-full` (prefer `verify-full` with the deployment CA). Session cookies default to Secure; for local HTTP only, opt in explicitly with `SESSION_COOKIE_MODE=local-insecure` and a non-production `APP_ENV`. `TRUSTED_PROXY_CIDRS` is an optional comma-separated list; forwarded client IP headers are ignored unless the direct peer belongs to one of these CIDRs. `NIMIQ_SIGNING_SCHEME` selects which envelope wallet signatures are verified against — `raw` (default, the message bytes as handed to `sign()`) or `hub` (the Nimiq signed-message envelope). The Mini Apps API reference specifies `sign()`'s parameters and result but not what the host signs, and `@nimiq/mini-app-sdk` forwards the message untouched, so the value is settled by one device capture: `go run ./cmd/verify-sign-fixture -scheme auto -message '<challenge>' -wallet 'NQ…' -public-key <hex> -signature <hex>` names the scheme that verifies. Exactly one scheme is ever active; the server never falls back between them. `NIMIQ_CONFIRMATION_POLICY` selects how much chain certainty a payment must accumulate before the Pass is issued — `inclusion` (default) issues on canonical micro-block inclusion and tracks finality in the background, `finality` waits for the macro block. It governs the wait, not the validation: network, recipient, exact Luna, reference or sending wallet, execution result, canonical inclusion, the intent's window and global hash uniqueness are required under both, and a mempool transaction settles nothing under either. Under `inclusion` a Pass exists for up to a batch on evidence that is canonical but not yet irreversible and is redeemable in that window; a settlement the chain later reverses withdraws the Pass and opens a `PAYMENT_SETTLEMENT_REVERSED` compensation case with `doNotPayAgain: false`. An unrecognised value fails startup. See `docs/DECISIONS.md` ADR-021. `.env.example` contains placeholders; the application does not automatically read `.env` files.

From `backend/`:

```sh
go run ./cmd/migrate
go run ./cmd/server
```

For a local Nimiq Pay Testnet run, copy `.env.example` to the ignored
`.env.testnet.local`, replace the PostgreSQL and Testnet RPC values, set
`PUBLIC_ORIGIN` to the frontend's LAN URL, then run:

```sh
./start-testnet.sh
```

The helper applies migrations and starts the server, but refuses `MAINNET` and
`production`. It does not start PostgreSQL; the database must already be
reachable and must be disposable for local testing. Set
`NIMPASS_ENV_FILE=/absolute/path/to/your.env` to load another local env file.

From the repository root, `./start.sh` is the zero-configuration local
convenience path. When `NIMPASS_ENV_FILE` is not set, it creates the ignored
Testnet env files with loopback PostgreSQL and Testnet-safe defaults, discovers
the active LAN IPv4 address, starts an installed local PostgreSQL service when
needed, creates `nimpass_test`, and prints the Custom URL for Nimiq Pay. It
does not install PostgreSQL or start a Nimiq node; if the default local RPC at
`http://127.0.0.1:8648` is unavailable, the launcher explains that real
payment reconciliation needs a synced Testnet RPC. Setting `NIMPASS_ENV_FILE`
explicitly bypasses these conveniences and leaves the supplied deployment
configuration untouched.

That node is run separately by `./scripts/testnet-node.sh start` (repository
root), which runs the official `ghcr.io/nimiq/core-rs-albatross` image as a
Testnet **history** node — `getTransactionByHash` needs the history index — with
its RPC published on `127.0.0.1:8648` only, so nothing on the LAN can reach it.
`status` reports network, consensus and head block; `wait` blocks until
consensus is established. Chain data lives in the ignored `.nimpass-node/`
directory. The node holds no wallet, no validator key and no funds, and it is
development tooling only: a deployment supplies its own trusted, synced RPC
endpoint. Until consensus is established the backend cannot verify any payment,
so purchases stay pending and no Pass is issued.

The server requires PostgreSQL and a configured RPC URL. It rejects a reachable RPC network mismatch or malformed response at startup; a temporary RPC outage is logged and payment reconciliation retries while public reads remain available. `GET /health/live` reports process health; `GET /health/ready` checks PostgreSQL and the full migration version/checksum set. Ship the `migrations/` directory with the binary, or set `MIGRATIONS_DIR` to its absolute path. The versioned API contract is [openapi.yaml](openapi.yaml). Mission 02 implements authentication and catalog management. Mission 03 adds purchase intents, transaction verification, macro-block finality, background/manual reconciliation and atomic Pass creation. Mission 04 adds customer-signed redemption challenges, opaque short-lived redemption references, provider lookup, explicit provider confirmation, atomic one-session consumption and customer/provider history. The HTTP server has bounded headers/body handling, production security headers, sanitized correlation IDs and explicit read/write/idle timeouts.

The frontend signs the exact `message` returned by `POST /api/v1/auth/challenges` or the payout/redemption challenge endpoint with Nimiq Pay `sign(message)` and sends the returned hex `publicKey` and `signature`. Payout verification additionally needs `ownerPublicKey` and `ownerSignature` from a fresh signature by the authenticated login wallet over that same message. The backend never accepts a client-reconstructed message or a claimed wallet without public-key binding. The Nimiq Mini App documentation specifies the response shape but not the precise host-side signing prehash/prefix semantics; the isolated `internal/nimiq` adapter uses the single configured `NIMIQ_SIGNING_SCHEME` with no runtime fallback. Its default remains `raw`; no live evidence was used to change it. `go run ./cmd/verify-sign-fixture -message "$MESSAGE" -wallet "$WALLET" -public-key "$PUBLIC_KEY" -signature "$SIGNATURE"` reports which supported scheme verifies a captured fixture, independently of the server configuration. A fixture consists of exactly `wallet`, `message`, `publicKey`, `signature`, and expected `verified` result; it never contains a private key. A real Nimiq Pay WebView fixture remains a release blocker.

Authenticated browser requests use `credentials: 'include'`. Every unsafe method requires the configured Origin or Referer fallback; authenticated unsafe methods also require `X-CSRF-Token`, returned on login and `GET /api/v1/auth/session`. Responses are `Cache-Control: no-store`. Public discovery requires no wallet login.

Session lookup infrastructure failures return `500 INTERNAL_ERROR` and preserve the cookie so the same session can recover. `401 AUTH_REQUIRED` identifies a missing, invalid, expired or revoked session.

The API uses exact-origin credentialed CORS only. Security responses include `nosniff`, `no-referrer`, `DENY` framing, a backend-only CSP, a restrictive Permissions-Policy, and HSTS in production. Request IDs are server-generated unless a bounded safe correlation value is supplied; CR/LF and oversized values are discarded. Rate limits use atomic PostgreSQL buckets shared by all replicas and survive process restarts. Bucket keys are hashed and expire; the worker deletes up to 10,000 expired buckets per tick. Database errors fail closed. The in-memory limiter is used only by database-free unit-test handlers.

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

`internal/domain` owns value objects and aggregates: Identity, Provider, Service, Pass, Purchase, PurchasedPass, RedemptionChallenge, and Redemption. `internal/application` orchestrates authentication, catalog and payment use cases. `internal/nimiq` isolates address derivation, signing preprocessing and the real PoS JSON-RPC adapter. `internal/database` owns PostgreSQL repositories and forward-only, checksum-checked migrations. `internal/httpapi` owns transport DTOs and policy middleware.

Purchase confirmation requires exact transaction matching, main-chain inclusion and the next macro block on the main chain. Candidate hashes do not globally reserve payment ownership; the unique verified receipt, Purchase confirmation and Pass insert commit in one PostgreSQL transaction. Redemption uses `POST /api/v1/passes/{passID}/redemption-challenges`, `GET /api/v1/passes/{passID}/redemption-challenges/current`, customer `AUTHORIZE_REDEMPTION` signing, `POST /api/v1/redemption-challenges/{challengeID}/authorization`, provider-owned `POST /api/v1/providers/{providerID}/redemptions/lookup`, then explicit `POST /api/v1/providers/{providerID}/redemptions/confirm`. Lookup is non-consuming and returns only safe service/Pass/session context; only the explicit confirm consumes a session. The reference is `NR1:<64 lowercase hex characters>`; only its SHA-256 digest is stored and a rotated reference invalidates the previous one. Provider lookup and confirmation require the authenticated provider session and never trust reference possession alone. Redemption, Pass updates, challenge consumption and audit events commit in one PostgreSQL transaction. Redemption history is available through the customer Pass and provider history endpoints. Live Nimiq Pay sign() interoperability remains a release blocker.

The purchase intent TTL is 30 minutes. For fixed-expiration Passes, new intents stop at `Pass.expires_at - 35 minutes` (TTL plus five-minute settlement grace); the cutoff does not change the Pass or an already-valid intent. Submitted or verifying payments are never automatically expired by the domain state machine; background or manual reconciliation settles them. An expired intent may use the five-minute settlement grace only if the backend observed the matching transaction in the mempool before expiry; submitting a hash alone is not broadcast proof. An expired intent cannot accept a new wallet submission. Pass expiration currently stores an optional fixed UTC date and snapshots it into purchases and passes. Relative-duration expiration is not implemented.

If a matching payment is verified and macro-finalized only after its fixed Pass expiration prevents activation, the transaction atomically claims the unique verified receipt, records `COMPENSATION_REQUIRED` and an open compensation case, and creates no Pass. The API returns no further payment request and explicitly says not to pay again. The case persists reason, receipt, status, and future manual refund/reissue resolution metadata; there is no automatic refund or provider-key custody. The customer/provider remediation workflow itself is not implemented. The Mini App `sign()` preprocessor remains unproven without a live Nimiq Pay signature fixture. Release validation remains pending until real Nimiq Pay signing and the complete Testnet lifecycle are captured. See [Mission 05 audit](MISSION-05-REPORT.md).

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

## Browsing a seeded local account

Every customer-owned screen (My Passes, pass detail, history) and the whole
provider workspace (`/provider/**`, including Create Pass) are behind a
backend-issued session, and a session is only issued against a real Ed25519
signature from Nimiq Pay. In a desktop browser there is no wallet to produce
one, so those screens cannot be opened at all — including just to look at them.

`cmd/seed` fills a local database with an account that can be browsed, and mints
a session cookie for it:

```sh
DATABASE_URL=postgres://…/nimpass_dev go run ./cmd/seed -display-name "Your Name"
```

It writes two sides of the product. The buying side: five providers with their
services, catalog passes, confirmed purchases and purchased passes (two active,
two completed, one expired) with the redemption rows behind them. The selling
side: a provider account owned by *this same wallet* (two services, one
published pass and one draft), which is what makes `/provider` and
`/provider/passes/new` open rather than stopping at "You don't have a provider
account yet".

`-display-name` is the public name that wallet sells under. It is a real
creator name — it appears as "Provided by" on every pass this account publishes,
to every visitor on Discover whether they are signed in or not — so the seed
never invents one. Without the flag the selling side is skipped entirely and the
app's own "Set up your workspace" step asks for the name instead. A reseed
without the flag never overwrites a name already in the database — rename
yourself on Profile and it survives, along with the slug your public link uses —
and passing the flag again is the one way the command renames a workspace.

It then prints a `document.cookie = …` line to paste into the browser console
once. The cookie is host-scoped, so the frontend and the API both receive it; it
lasts 24 hours. `go run ./cmd/seed -clear` removes what it created.

Re-running is safe next to real activity. The purchase/pass/redemption chain it
owns is replaced outright, but providers, services and catalog passes are kept
whenever a purchase someone actually started in the app still points at them,
and upserted rather than recreated — a reseed never deletes a record a person
made.

These are ordinary rows served by the ordinary endpoints. Nothing is faked
inside the app: the frontend's fixture layer stays catalogue-only and still
refuses to invent passes, purchases or redemptions
(`frontend/web/src/dev/README.md`). The command refuses to run against a
non-local database host or with `APP_ENV=production`, and it is a separate
binary that no build imports.

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
export NIMPASS_PASS_ID=...
go run ./cmd/live-testnet-harness -phase intent

export NIMPASS_PURCHASE_ID=...
export NIMPASS_TX_HASH=...
go run ./cmd/live-testnet-harness -phase submit

export NIMPASS_PURCHASED_PASS_ID=...
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

Readiness checks PostgreSQL connectivity and migration version/checksum equality with the shipped release. Temporary Nimiq RPC failure leaves public reads available while payment reconciliation remains retryable through the background worker or manual reconciliation endpoint. Public catalog, purchases and redemption histories retain their bounded 100-record contracts. Customer Passes have a separate cursor-paginated endpoint described below.


## Mission 05 product contract

Canonical routes include the `/api/v1` prefix:

| Route | Contract |
| --- | --- |
| `GET /public/categories` | Nine canonical category slugs; no login required. |
| `GET /public/passes?category=music` | Server-side exact category filter, at most 100 offers, newest first with ID tie-breaker. Empty/omitted means all; unknown or repeated values return `VALIDATION_ERROR`. |
| `GET /public/providers/by-slug/{slug}` | Verified provider's explicit public profile. The existing `/public/providers/{providerID}` lookup remains supported. |
| `GET /public/providers` | The provider directory: every provider with a verified payout wallet and at least one publicly listable pass, with that count. Up to 200, most passes first. |
| `GET /public/passes?provider={id}` | One provider's public storefront, under the same visibility rule as the whole catalogue. |
| `DELETE /catalog/passes/{passID}` | Owner-only. Archives the pass: no new purchases, gone from the owner's catalogue and from discovery, not editable or republishable. Purchases, verified payments and already-purchased customer passes are untouched. |
| `GET /passes?limit=20&status=ACTIVE&cursor=…` | Own Passes only; `limit` 1–100, default 20. Optional status: ACTIVE, COMPLETED, EXPIRED, CANCELLED. Returns `{items, nextCursor}`; null cursor ends pagination. |

Provider input/output adds `slug`, `headline`, `bio`, `avatarUrl`, `location`; `name` remains the display name. On creation a custom slug is normalized by trimming and lowercasing, must use ASCII letters/digits with single internal hyphens, be 3–80 characters, and avoid reserved values and UUIDs. Duplicate slugs return `CONFLICT`. When omitted, the server takes the most readable slug still free — `emin-kutlu`, then `emin-kutlu-2` … `emin-kutlu-9`, then a name prefix plus UUID suffix that cannot collide; the unique constraint decides, and a name that cannot form a valid slug goes straight to the UUID form. Migration backfills old providers with the UUID-suffixed form and never re-slugs them. Slugs cannot change after creation, including through SQL updates. Name edits preserve shared URLs. Private authorization continues to use provider ID and authenticated ownership.

Profile edits preserve omitted/null optional fields; `""` clears text/media fields. Limits are UTF-8 bytes: headline/location 160, bio 2,000, avatar URL 2,048. Avatar references must be HTTPS URLs without credentials or fragments. They are never fetched or uploaded by the backend. No cover field or upload/storage infrastructure is introduced: the current documented minimum does not require it. Public profile responses never contain payout wallets, ownership internals, session data or audit records.

Service create/edit/output adds `category`. Values: `fitness`, `tutoring`, `languages`, `coaching`, `wellness`, `music`, `beauty`, `consulting`, `mentoring`. The empty string means unclassified and maps to SQL NULL; legacy records stay unclassified. Omitted category on edit preserves the existing value. Passes inherit their service's current category, exposed as `offer.service.category`; no duplicate Pass taxonomy or historical category snapshot is invented.

Pass list and detail share the same DTO. In addition to the previous fields, they expose existing immutable snapshots `serviceName`, `providerName`, `priceLuna`, and the stored `completedAt`. List expiry is evaluated before filtering. Pagination uses `(created_at, id)` descending, avoiding offset duplication for equally dated records. Keep the status filter the same across pages; concurrent redemption can naturally move an item between status groups. A cursor is pagination context, never authorization.

## Deployment contract

Startup order is: validate environment/config → connect PostgreSQL → verify all migration versions/checksums → bind database network/environment → inspect RPC network → bind HTTP listener → start worker and serve requests. Migrations run explicitly before startup, not inside the server. Versions 1–7 are preserved; Mission 05 adds versions 8 and 9. A database is bound to one network/environment on first server boot; subsequent mismatches and incompatible pre-existing purchases/challenges fail startup. Use separate databases for development, Testnet and Mainnet deployments; do not relabel existing payment data.

`PUBLIC_ORIGIN` is one exact frontend origin. Production uses HTTPS with credentialed CORS; headers allow `Content-Type`, `X-CSRF-Token`, `Idempotency-Key`. Deploy frontend/API on the same site (for example `app.example.com` and `api.example.com`) so SameSite=Lax session cookies work. Cross-site cookie support is not implied by CORS. Production cookies are `__Host-nimpass_session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, 24-hour Max-Age and matching server expiry. Local HTTP requires explicit non-production `SESSION_COOKIE_MODE=local-insecure`.

`TRUSTED_PROXY_CIDRS` must contain only actual ingress peers. Without it, X-Forwarded-For is ignored. Behind trusted peers, walk the chain from right to left to the first untrusted address; malformed chains fall back to the direct peer. Never configure all internet addresses as trusted. The edge should overwrite/append the real peer address according to this trust model.

RPC calls have a five-second HTTP timeout and an eight-second total inspection deadline, honor cancellation, reject redirects, cap response bodies at 2 MiB, and validate JSON-RPC IDs/envelopes. A transport/RPC failure leaves payment uncertain, never paid or definitively failed. Startup tolerates transient RPC unavailability so public browsing can continue; a reachable wrong/malformed network response fails startup.

The reconciliation worker ticks every ten seconds, loads at most twenty due purchases and inspects at most four concurrently. Persisted retry counts back off uncertain/not-found results to 60, 120, 240, then 480 seconds; matching mempool/finality observations reset the count to a 30-second interval. Manual reconciliation remains rate limited and can check sooner. Unresolved payments stay recoverable indefinitely; there is no automatic abandonment or repay instruction. Replicas may perform duplicate RPC reads, but transactional locks, candidate guards and unique receipt/Pass constraints prevent duplicate effects. Restart recovery reads the durable candidate table.

SIGTERM closes the listener through HTTP Shutdown, cancels the worker, grants HTTP requests ten seconds, force-closes remaining connections after that grace period, waits for worker completion and closes the DB pool. Request logs record route templates, statuses and timing rather than user-controlled URL paths/bodies; database connection and RPC failures avoid credential-bearing error strings.

## One-command signature fixture validation

Capture the exact server message and Nimiq Pay response in a local JSON file (keep it out of git and CI logs):

```json
{"wallet":"NQ…","message":"exact server challenge including newlines","publicKey":"hex","signature":"hex"}
```

From `backend/`:

```sh
go run ./cmd/verify-sign-fixture -fixture /private/path/auth-login.json -scheme auto
```

The command independently reports whether the derived wallet matches the expected wallet, whether raw verification passes, and whether the Hub envelope passes. It never prints the capture. Input is bounded to 32 KiB, unknown fields (including private-key fields) are rejected. Use `-fixture -` to read stdin. Exit 0 means a supported scheme and expected wallet match; 1 means no match; 2 means invalid input. An optional `verified` boolean asserts an expected result but never causes an invalid signature to be reported as valid. Individual legacy flags remain supported but the file/stdin method avoids putting signatures in shell history or process arguments.

## Live Testnet release validation — operator sequence

1. Use an isolated `TESTNET` database and trusted synced PoS RPC. Set APP_ENV, DATABASE_URL, PUBLIC_ORIGIN, NIMIQ_RPC_URL, NIMIQ_NETWORK, cookie mode and optional proxy CIDRs. Run migrations; check `/health/live` and `/health/ready`.
2. Inside real Nimiq Pay, capture an `AUTH_LOGIN` challenge and the response to `sign(message)`. Run the fixture command above. Record device/OS, wallet app version, deployment commit, timestamp, result and fixture location privately.
3. Configure exactly the observed scheme, restart, request a fresh login challenge and complete authentication. Never replay the captured challenge as a new login. Verify cookie/CSRF behavior in the actual WebView.
4. Create a provider and profile, request `VERIFY_PROVIDER_WALLET`, sign with the payout wallet and freshly with the login wallet. Complete payout verification. Confirm public profile excludes payout information.
5. Create a service with a canonical category, activate it, create and publish a Pass. Confirm slug lookup and server-side Discover filtering.
6. As a customer, create a Purchase Intent (or harness `-phase intent`). Check TESTNET, exact Luna amount, snapshotted recipient and reference.
7. Submit one real Testnet transaction from Nimiq Pay using the exact payment request; record its hash. Submit that hash once (or harness `-phase submit`).
8. Inspect authoritative reconciliation: RPC confirmation → main-chain inclusion → macro finality. Test browser closure/reopen and transient RPC failure. Do not pay again on uncertainty.
9. Verify one Pass exists and appears in `/passes` with the purchased names/price/session count. Duplicate submission/reconciliation must not create another Pass.
10. Create a redemption challenge (harness `challenge`), sign `AUTHORIZE_REDEMPTION` in the real wallet and authorize (harness `authorize`). Check wrong-purpose signatures and cancelled approvals leave counts unchanged.
11. As the owning provider, look up the NR1 reference (harness `lookup`). Verify safe context and no session decrement. Cross-provider requests must fail.
12. Explicitly confirm (harness `confirm`). Check exactly one decrement and matching customer/provider histories. A replay must fail.
13. Repeat with fresh challenges to the final session: remaining=0, COMPLETED, further consumption impossible. Save sanitized evidence and then make the release verdict. A compensation response requires operator remediation and must never instruct another payment.

Live fixture/payment evidence is required before removing the release blocker. Local Ed25519 fixtures, stubbed RPC tests and PostgreSQL concurrency tests do not replace it.
