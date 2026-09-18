# Nimiq integration report — 2026-09-16

## Status

The accepted desktop purchase-locator handoff is implemented. Automated and
local lifecycle checks passed. **Real Nimiq Pay device interoperability, a real
Testnet payment, and desktop → phone → purchased Pass are not verified.**
The configured local Testnet RPC at `127.0.0.1:8648` was unavailable. No payment
was sent during this work. This is not production sign-off.

## 1. Root causes discovered

- Frontend network resolution silently selected Testnet for invalid/missing values.
- Hub address selection could be mistaken for authentication; a successful proof
  response did not establish that the browser actually retained its session cookie.
- The launcher mixed localhost page URLs with a LAN API/origin. Cookies and exact
  origin checks could prevent recovery. DHCP changes left generated values stale.
- Logout swallowed server errors and could show signed-out UI without revocation.
- Desktop Hub checkout was inconsistent with the requested native phone checkout.
- Consecutive payout signatures gave no opportunity to change wallets.
- An unreported wallet broadcast could permit another attempt after reload.
- Restart could race the old launcher's cleanup, deleting the new PID directory.

The user's particular prior login failure was not reproduced through a completed
real signature. These are inspected defects, not a claim that every observed
login problem had the same cause.

## 2. Incorrect assumptions corrected

Wallet availability, selected address, and authenticated backend session are
separate states. Hub does not automatically connect a phone-only wallet.
An SDK `getNetwork()` namespace is not a Mainnet/Testnet check. A hash or wallet
success is not payment verification. Native signature preprocessing is not
established by observing that the SDK forwards plain text. Tests with mock
providers cannot prove native interoperability.

## 3. Official sources

Read on 2026-09-16:

- [Mini Apps and official openers](https://nimiq.dev/mini-apps)
- [Nimiq provider API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
- [Local loading and Testnet settings](https://nimiq.dev/mini-apps/development/load-local-mini-app)
- [Hub setup and endpoints](https://nimiq.dev/hub/getting-started)
- [Hub accounts/authentication](https://nimiq.dev/hub/guide/accounts)
- [Hub transactions](https://nimiq.dev/hub/guide/transactions)
- [Hub API reference](https://nimiq.dev/hub/api-reference)
- [Transactions with data](https://nimiq.dev/web-client/guides/send-transactions)
- [Official request-link encoder](https://github.com/nimiq/nimiq-utils/blob/master/src/request-link-encoding/RequestLinkEncoding.ts)

Installed `@nimiq/mini-app-sdk` 0.1.0 and Hub API implementations/types were also
inspected. No new runtime dependency was needed for this handoff.

## 4. Final runtime architecture

Nimiq Pay uses the injected provider through SDK initialization. Browsers use
Hub for account selection and signed authentication. Browser purchases show a
phone handoff; `usePurchaseFlow.pay()` dispatches only through a Mini App
transport. The existing Hub payment adapter is retained for compatibility but
is not called by the product checkout. Both surfaces use one backend domain.

## 5. Authentication architecture

Account selection → backend challenge → separate signature action → backend
proof verification → cookie-backed `GET /auth/session`. Only the recovered
session unlocks private UI. Challenges remain purpose-, wallet-, network-,
environment-, TTL- and nonce-bound. Explicit Hub proof preprocessing remains;
unknown schemes fail, and native defaults are not guessed by trying schemes.

## 6. Session/authorization architecture

Private routes use the backend session, not wallet selection. Purchase reads
require ownership. Sign-out first revokes the server session; failure is shown
and the local session remains. Success or an already-invalid session clears
private purchases/passes/provider/redemption queries and CSRF state. The local
Vite proxy keeps cookies on the page origin and translates only matching local
Origin/Host requests to the canonical LAN origin. Foreign origins still fail.

## 7. Desktop QR architecture

1. An authenticated customer creates a purchase intent.
2. The QR encodes the official HTTPS opener
   `https://nimpay.app/miniapps/open/<host>/purchases/<id>`, or the purchase
   page URL itself where the host is a LAN/localhost dev address. The custom
   scheme `nimiqpay://miniapp?url=...` remains the tap link, not the QR: a
   phone camera reads http(s), and Nimiq Pay's own scan button is a payment
   scanner that rejects Mini App links with "Invalid link format. Only CPLinks
   and NAKA requests for NIM and Bitcoin Lightning requests are supported."
   (observed on device, 2026-09-16). The screen now says which scanner to use.
3. The URL contains a UUID locator only, with no recipient, amount, secret, or
   authoritative payment data. Phone authentication is mandatory.
4. Phone and desktop customer identities must match. Backend `expected_wallet`
   remains the source of ownership; no reassignment to the payer occurs.
5. Phone reloads terms and submits its native transaction hash.
6. Desktop polling/reconciliation observes the same purchase and owned Pass.

The UUID is not a bearer credential; purchase TTL remains 30 minutes. A launcher
provided LAN origin prevents localhost QR links when testing from desktop.
Official opener behavior with full encoded LAN paths still needs device testing.

## 8. Native purchase and duplicate prevention

Review uses backend recipient, exact Luna value, network, NP1 data and expiry.
The user checks the selected wallet and explicitly confirms the Pay network.
Before `sendBasicTransactionWithData()`, a database row lock grants one dispatch.
Concurrent devices and replay fail; subsequent reads omit payable instructions.

Unknown dispatch/broadcast outcomes persist across reload/expiry and block a
second intent for that customer/product. Definite pre-broadcast rejection can
release only the matching attempt, with no submitted candidate. A locally saved
public hash is a recovery hint, never authority. Lost callbacks without a hash
require wallet-history/support investigation; locks do not auto-expire.
The existing submission TTL is preserved, so late receipts require investigation.

Backend recipient/value/data/network/sender/execution/finality/uniqueness checks
and atomic single-Pass issuance remain in effect. Automated database tests exercise
mismatch rejection and concurrent settlement as well as the new dispatch lock.

## 9. Network architecture

Environment/network are mandatory. Development/test requires TESTNET; production
requires MAINNET on frontend and backend. Wallet-sensitive operations compare the
public backend config with the frontend configuration. Local proxy conveniences
are forbidden in production. API/RPC outages never simulate payment success.

The current Mini App API has no documented selected-NIM-chain getter/switch or
payment sender parameter. The UI states this limitation and requests explicit
confirmation. Backend rejection cannot reverse an already-broadcast wrong-chain
or wrong-wallet payment. See ADR-005.

## 10. Payout wallet verification

Identical payout and owner wallets use one fresh challenge signature in both
proof fields; the backend still verifies both roles. Different wallets require
a second explicit action, including in Nimiq Pay, allowing a wallet switch.
Changing signing runtime midway is rejected. The server remains authoritative
for signer identity and successful payout verification.

## 11. Redemption

The existing challenge → exact-message signature → backend authorization → opaque
reference → provider lookup → explicit confirmation flow remains. A network/config
check precedes signing. Lookup does not consume a session. Backend tests retain
ownership, signature, replay, concurrency and final-session protections. Native
signature output and camera flows were not device-tested.

## 12. Main files changed

- Root `start.sh`: canonical LAN origin, same-origin proxy, supervisor lifecycle.
- Backend config, payment repository/DTO/router, new wallet-attempt handlers and
  migration `000010_wallet_payment_attempt.up.sql`; OpenAPI contract.
- Frontend deployment/runtime checks, session provider, payout/redemption hooks,
  purchase hook, purchase approval component, `/purchases/:id` route and opener.
- Focused regression tests and relevant documentation.

The working tree already contained extensive unrelated changes, including the
Pass product rename/ADR-004. Those were preserved. Migration upgrade tests were
adapted to insert historical fixtures using the pre-rename table name.

## 13. Backend contract changes

- `GET /api/v1/public/config` returns environment and network.
- `POST /purchases/{id}/wallet-attempts` accepts a random attempt UUID and grants
  one dispatch to the authenticated owner.
- `POST /purchases/{id}/wallet-attempts/{attemptID}/release` reports definite
  pre-broadcast cancellation, preserving all candidate evidence.
- `uncertain_retryable` means reconciliation may be retried, **not payment**;
  a possible wallet dispatch has `paymentRequest: null`.

No new authentication bypass, client-selected recipient/value, or fake chain
settlement endpoint was introduced.

## 14. Frontend changes

Desktop QR, native review/approval, same-wallet mismatch copy, cookie recovery
failure copy, honest failed logout, guarded purchase URLs, public hash recovery,
and pending-intent polling are implemented. Expired/cancelled catalog purchases
may create a fresh intent only when no payment was possible; a phone locator
never silently creates a different purchase.

## 15. Regression coverage

Tests cover explicit deployment combinations, locator contents/LAN origin,
missing session cookie, failed logout, single/two-step payout signing, native
exact payment data, wrong customer/network, lost dispatch response, stored hash
recovery, desktop polling without wallet payment, eight concurrent dispatches,
replay, expiry, cancellation and preservation of submitted evidence.

## 16. Automated and launcher results

- Frontend: 55 files / 541 tests passed; TypeScript and lint passed.
- Backend: `TEST_DATABASE_URL=...nimpass_test go test ./...` passed with real
  PostgreSQL in temporary per-test schemas; no user database reset.
- Optimized frontend build and local backend migrations/startup passed.
- Separate test instance: backend 8081, frontend 5174; preview and dev modes worked.
- Duplicate invocation rejected clearly. Restart succeeded after supervisor fix.
- Backend crash and frontend crash shut down the other service; both ports closed.
- SIGINT (terminal process-group Ctrl+C equivalent) and SIGTERM removed the owned
  process trees and run record. PostgreSQL intentionally remained running.
- Localhost same-origin challenge succeeded; a foreign Origin returned 403.

Only processes belonging to the test instance were used for crash tests.
Root `./start.sh` also passed with the optimized build on 8080/5173. Actual
PTY Ctrl+C exited 130; both listeners and PID record were removed. The final
state is stopped. No Testnet RPC was started.

## 17. Separate validation matrix

| Validation | Result | Evidence/limit |
| --- | --- | --- |
| Automated tests | PASS | Counts and commands above; wallet/chain doubles distinguished from PostgreSQL |
| Desktop manual browser | PARTIAL | Real Chrome rendered catalog and protected purchase route; Testnet Hub account selection and backend AUTH_LOGIN message opened in Keyguard. Personal wallet password was required, so signing/login completion and authenticated QR view were not manually verified |
| Nimiq Pay real device | NOT RUN | No native device approval or signature fixture captured |
| Testnet real payment | NOT RUN | Configured local RPC unavailable; no transaction sent |
| Desktop QR → phone → Pay → backend → Pass | NOT RUN | Native opener/signature/payment/finality remain to be exercised on device |

## 18. Remaining protocol and release checks

Run `./start.sh`, open the printed LAN URL, and use the same Testnet wallet on
desktop and phone. Configure/start a synced Testnet RPC first. Complete a real
native login signature fixture, purchase, cancellation, lost callback/reload,
wrong-wallet rejection, payout wallet switch and redemption. Confirm exact NP1
bytes, real RPC shapes and finality before marking payment E2E verified.

The launcher is local Testnet tooling, not production deployment. Production
still requires HTTPS ingress, secure cookies, MAINNET configuration, a dedicated
database, working RPC, backups/monitoring and ownership of uncertain payments.

Mini Apps checklist: **PASS** SDK initialization/error handling, native approval
boundaries, no key handling, explicit cancellation/uncertainty, LAN access and
secure random dispatch IDs. **NOT VERIFIED** real device layout/opener/signature/
network behavior. **SKIP** EVM/ERC-20 rules (this flow uses NIM only).
