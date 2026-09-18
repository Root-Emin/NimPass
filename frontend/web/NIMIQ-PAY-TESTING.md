# Nimpass release test matrix — Nimiq Pay on testnet

Derived from the current Nimiq Developer Center (re-checked September 2026):

- [Load a Local Mini App](https://nimiq.dev/mini-apps/development/load-local-mini-app)
- [Nimiq Provider API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
- [Mini Apps overview](https://nimiq.dev/mini-apps)
- [Mini Apps FAQ](https://nimiq.dev/mini-apps/faq)

Desktop-browser testing is not sufficient. Nimpass only meets the Nimiq provider
inside the Nimiq Pay WebView, so the wallet half of the product stays unproven
until this matrix has been walked on a real device against testnet.

---

## Execution status

> ### `RELEASE VALIDATION BLOCKED ON PHYSICAL NIMIQ PAY TEST`
>
> **Every row below is `NOT EXECUTED`.** No step here has been run on a device.
>
> This file is a procedure and a record. A row may only be moved to `PASS` by
> someone who actually walked it, and only together with the evidence its column
> asks for. A green automated suite is not evidence for any row: the 401 tests
> in `npm test` prove Nimpass reacts correctly to what a provider returns, not
> that the real provider returns it.

**Status vocabulary**

| Status | Meaning |
|---|---|
| `PASS` | Walked on a real device, observed working, evidence recorded |
| `FAIL` | Walked, did not behave as the Expected column says |
| `BLOCKED` | Cannot be walked yet; the Blocker column says what is missing |
| `NOT EXECUTED` | Nobody has tried |

---

## Setup

1. **Same Wi-Fi.** Phone and dev machine on one network.
2. **Start the frontend with LAN access:**
   ```bash
   cd frontend/web && npm run dev
   ```
   `server.host: true` is already set in `vite.config.ts`; note the **Network**
   URL, e.g. `http://192.168.1.105:5173`.
3. **Point the frontend at a reachable backend.** Inside the WebView,
   `localhost` is the *phone*. Set `VITE_API_BASE_URL` to the dev machine's LAN
   IP (e.g. `http://192.168.1.105:8080`) — not `localhost`.
4. **Backend CORS.** The backend echoes a single configured origin
   (`config.PublicOrigin`), so it must be set to the Network URL
   (`http://<lan-ip>:5173`). Any other origin is refused at preflight.
5. **Backend network + RPC.** Backend `NETWORK=TESTNET` and its Nimiq RPC URL
   must point at a testnet node. A frontend on `TESTNET` against a backend on
   `MAINNET` is the one misconfiguration that can move real money — check both
   before step 1.
6. **Open in Nimiq Pay:** Nimiq Pay → Mini Apps → Custom URL → the Network URL.
7. **Switch to testnet:** long-press the settings button for 10 seconds, choose
   **Testnet**. This clears transaction history and reloads. It affects Nimiq
   operations only.
8. **Fund the wallet:** on testnet the home empty state and the Top Up modal
   show **Get free NIM** — 110,000 testnet NIM per request.
9. **Two devices for redemption.** Device A = customer in Nimiq Pay.
   Device B = provider (a second phone or a laptop). The provider side needs a
   separate wallet and its own provider account.

---

## Step 0 — the decisive test: which signing scheme does Nimiq Pay use?

**Walk this before anything else. It is five minutes and it decides whether the
product works at all.**

Nimiq's documentation does not state what `sign(message)` does to the message
before signing. Two schemes are plausible: the raw UTF-8 bytes, or the Hub's
`\x16Nimiq Signed Message:\n<len>` envelope hashed with SHA-256. The backend
verifies whichever scheme `NIMIQ_SIGNING_SCHEME` names — `raw` by default
(`nimiq.RawMessage`) — and deliberately never silently tries the other.

If Nimiq Pay uses the envelope, then **login, payout verification and redemption
authorisation all fail on every real device**, and no amount of frontend work
changes that. This one test tells you which world you are in.

| # | Step | How |
|---|---|---|
| 0.1 | Get a real challenge | In Nimiq Pay, tap Sign in. Before approving, copy the exact `message` the backend returned (visible in the network log, or log it temporarily in a dev build) |
| 0.2 | Sign it | Approve the native dialog; capture the returned `publicKey` and `signature` hex |
| 0.3 | Test both at once | `cd backend && go run ./cmd/verify-sign-fixture -scheme auto -message '<exact message>' -wallet '<NQ… address>' -public-key '<hex>' -signature '<hex>'` — it prints each scheme's result and names the one to configure |
| 0.4 | Or test one at a time | Same command with `-scheme raw`, then `-scheme hub` |

**Never pass a private key to that tool. It only needs the public half.**

| Outcome | Meaning | Action |
|---|---|---|
| `raw` verifies | Production config is correct | Proceed; mark `LIVE SIGN INTEROPERABILITY: PASS` |
| `hub` verifies | Production is configured for the wrong scheme | Set `NIMIQ_SIGNING_SCHEME=hub` and restart the backend — a configuration change, not a code change. Do **not** work around it in the frontend |
| Neither verifies | The capture is wrong, or a third scheme is in use | Re-capture, checking the message is byte-exact (no trailing newline added by copying) |

Status: `NOT EXECUTED`

---

## Step 0b — what does the Nimiq Pay payment scanner accept?

**Also five minutes, and it decides the shape of the desktop purchase flow.**

Nimpass wants the ordinary payment gesture: open Nimiq Pay, tap **Pay**, scan
the desktop QR, confirm. That only works if the scanner accepts a Nimiq payment
request *and* carries its `message` into the transaction's data field, because
the backend binds a transaction to a purchase by the exact `NP1:` bytes
(`application/payment.go:192`). No Nimiq document states what the scanner
accepts, and the app's own strings contradict each other — so measure it.

Full reasoning, evidence and the decision gates:
`docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md`.

```bash
cd frontend/web
node scripts/nimiq-pay-scan-probe.mjs --address "NQ.. your own testnet address"
open nimiq-pay-scan-probe.html
```

| # | Step | How |
|---|---|---|
| 0b.1 | Testnet | Nimiq Pay → long-press Settings 10s → Testnet |
| 0b.2 | Scan each candidate | Pay → scanner → scan A–E from the probe page. Record accepted/rejected and the **exact** error text |
| 0b.3 | Read the prepared transaction | For any accepted candidate: is the recipient right, the amount prefilled, and the `NP1:` reference shown as a message? |
| 0b.4 | Capture the app's own format | Nimiq Pay → Receive, set an amount, screenshot the QR. Whatever Nimiq Pay emits, its scanner reads |
| 0b.5 | Prove the data survives | Only for a candidate accepted **with** the reference: send it once on testnet, then read that transaction's data field back from the chain (`getTransactionByHash`). UI text is not proof |

| Outcome | Meaning | Action |
|---|---|---|
| A candidate keeps `NP1:` in `recipientData` | Scanner-first is possible | Record it in the investigation document, then build it together with the backend discovery work (§5 there) |
| Payments accepted, data dropped | Scanner-first cannot be matched securely | Keep the Mini App payment path; do not fall back to amount-matching |
| Everything rejected | Same, with a stronger reason | Keep the Mini App payment path |

Status: `NOT EXECUTED`

---

## 1. Runtime and public browsing

| # | Check | Expected | Status |
|---|---|---|---|
| 1.1 | Open the Network URL in Nimiq Pay | Shell loads; **no** wallet prompt on page load | `NOT EXECUTED` |
| 1.2 | Browse Discover → provider → Pass | Readable throughout, no dialogs | `NOT EXECUTED` |
| 1.3 | Wallet control before sign-in | Shows **Sign in**, not a connected state | `NOT EXECUTED` |
| 1.4 | Safe area, top | Header clears the status bar and notch | `NOT EXECUTED` |
| 1.5 | Safe area, bottom | Sticky purchase bar clears the home indicator | `NOT EXECUTED` |
| 1.6 | Rotate to landscape | No horizontal scroll; nothing clipped by the notch | `NOT EXECUTED` |
| 1.7 | Empty Discover | With no published Passes, Discover shows real empty copy — never an error, never invented content | `NOT EXECUTED` |
| 1.8 | Ordinary mobile browser (not Nimiq Pay) | Discover/provider/Pass all work; wallet actions explain the next step instead of failing | `NOT EXECUTED` |

## 2. Authentication

| # | Check | Expected | Status |
|---|---|---|---|
| 2.1 | Sign in → native account dialog | Appears only after the tap | `NOT EXECUTED` |
| 2.2 | Dismiss it | "Sign-in cancelled", no error styling, retry offered | `NOT EXECUTED` |
| 2.3 | Approve account access | Advances to the signing step | `NOT EXECUTED` |
| 2.4 | Signing dialog copy | States it is a signature and that no NIM is sent | `NOT EXECUTED` |
| 2.5 | Dismiss the signing dialog | "Sign-in cancelled", app still usable | `NOT EXECUTED` |
| 2.6 | Approve the signature | **Backend accepts it**; session established (this is Step 0 proven end to end) | `NOT EXECUTED` |
| 2.7 | Reload the WebView | Session recovers with no new dialog | `NOT EXECUTED` |
| 2.8 | Sign in, then tap Buy before approving | Second request refused — never two stacked native dialogs | `NOT EXECUTED` |
| 2.9 | Sign out | Session cleared; passes no longer listed | `NOT EXECUTED` |

## 3. Purchase

| # | Check | Expected | Status |
|---|---|---|---|
| 3.1 | Buy with NIM | Native payment dialog appears | `NOT EXECUTED` |
| 3.2 | **Dialog amount vs page price** | Identical — and the amount comes from the purchase intent, not the page | `NOT EXECUTED` |
| 3.3 | Dialog recipient | Matches the provider's verified payout wallet | `NOT EXECUTED` |
| 3.4 | Dismiss the dialog | "Payment cancelled · You were not charged"; retry offered | `NOT EXECUTED` |
| 3.5 | Approve the payment | "Confirming your payment…" + "Do not send another payment" | `NOT EXECUTED` |
| 3.6 | Watch the states | Progresses through confirming → **Finalising your payment…** → successful | `NOT EXECUTED` |
| 3.7 | Wait for macro-block finality | Reaches "Payment successful" only after the backend confirms | `NOT EXECUTED` |
| 3.8 | Reload mid-verification | Resumes from `?purchase=…`; Buy stays disabled | `NOT EXECUTED` |
| 3.9 | Back then forward mid-verification | Recovery, not a new intent | `NOT EXECUTED` |
| 3.10 | Airplane mode mid-verification | "Checking your payment…", never "failed", no retry | `NOT EXECUTED` |
| 3.11 | **Lock the phone through finality, return** | State revalidates from the backend on foreground — no frozen spinner | `NOT EXECUTED` |
| 3.12 | Double-tap Buy | Exactly one intent, one dialog | `NOT EXECUTED` |
| 3.13 | Buy a Pass expiring within 35 min | "Too late to buy this pass · You have not been charged" — not a payment error | `NOT EXECUTED` |

## 4. Pass

| # | Check | Expected | Status |
|---|---|---|---|
| 4.1 | My Passes | Shows the provisioned pass with real counts | `NOT EXECUTED` |
| 4.2 | Pass Detail | Original/used/remaining, status, expiry all from the backend | `NOT EXECUTED` |
| 4.3 | Edit the published Pass as the provider afterwards | The purchased pass keeps its terms — the snapshot does not follow | `NOT EXECUTED` |
| 4.4 | Session history | Empty before any redemption; no invented timeline | `NOT EXECUTED` |

## 5. Redemption — customer (Device A)

| # | Check | Expected | Status |
|---|---|---|---|
| 5.1 | Use a session | Explanation appears **before** the wallet opens | `NOT EXECUTED` |
| 5.2 | Explanation copy | "This is not a payment" / "No NIM is sent" | `NOT EXECUTED` |
| 5.3 | Dismiss the signing dialog | "Nothing was used"; **no code is produced** | `NOT EXECUTED` |
| 5.4 | Approve the signature | Backend accepts it; `NR1:` code and QR appear | `NOT EXECUTED` |
| 5.5 | Remaining count while the code is shown | Unchanged — showing a code uses nothing | `NOT EXECUTED` |
| 5.6 | QR readability on the phone | Scannable by Device B at arm's length, in normal indoor light | `NOT EXECUTED` |
| 5.7 | Let it expire (5 min) | "That code expired · No session was used" | `NOT EXECUTED` |
| 5.8 | Reload while a code is live | "Your session is still approved" → **Show a new code** issues a fresh one with no second signature | `NOT EXECUTED` |
| 5.9 | After rotation, the old code | No longer on screen; Device B rejects it | `NOT EXECUTED` |
| 5.10 | **Lock the phone with a code up, return after 6 min** | Countdown corrects itself from the backend; a dead code is not shown as live | `NOT EXECUTED` |

## 6. Redemption — provider (Device B)

| # | Check | Expected | Status |
|---|---|---|---|
| 6.1 | Workspace → Redeem | One tap from the workspace nav | `NOT EXECUTED` |
| 6.2 | Open Redeem | **No camera prompt** until Start scanning is tapped | `NOT EXECUTED` |
| 6.3 | Start scanning → deny permission | "Camera access was blocked… type the code instead" | `NOT EXECUTED` |
| 6.4 | Start scanning → allow → scan Device A's QR | **Decodes on this device** (see the iOS note below) | `NOT EXECUTED` |
| 6.5 | After the scan | Context appears — service, pass, session N, used/remaining, pass status, validity. **No session consumed yet** | `NOT EXECUTED` |
| 6.6 | Customer identity on this screen | Absent — no wallet, no email, no id | `NOT EXECUTED` |
| 6.7 | Tap Confirm session | Backend consumes exactly one; new counts come back | `NOT EXECUTED` |
| 6.8 | Device A after the confirm | Updates to "Session used" with the backend's remaining count | `NOT EXECUTED` |
| 6.9 | Scan the same code again | Refused as already used; **no second decrement** | `NOT EXECUTED` |
| 6.10 | Type a code by hand | Works with no camera at all | `NOT EXECUTED` |
| 6.11 | Type a malformed code | Look up stays disabled; nothing is sent | `NOT EXECUTED` |
| 6.12 | Scan a code for a different provider | Refused, with no hint about whose it was | `NOT EXECUTED` |
| 6.13 | Reload after a lookup, before confirming | Back to an empty scanner; no assumed success | `NOT EXECUTED` |
| 6.14 | Provider history | Shows the real redemptions just performed | `NOT EXECUTED` |

## 7. Final session

| # | Check | Expected | Status |
|---|---|---|---|
| 7.1 | Redeem down to the last session | Provider sees "Session used — pass complete" | `NOT EXECUTED` |
| 7.2 | Device A | Sees the completion, and the dialog does **not** vanish when the pass completes | `NOT EXECUTED` |
| 7.3 | Pass Detail afterwards | Status COMPLETED, 0 remaining, **Buy again** offered | `NOT EXECUTED` |
| 7.4 | Try to use a session on it | Not offered | `NOT EXECUTED` |

## 8. Provider onboarding

| # | Check | Expected | Status |
|---|---|---|---|
| 8.1 | Create a provider | Workspace becomes available | `NOT EXECUTED` |
| 8.2 | Payout wallet verification | Requires **both** signatures (new wallet + owner) | `NOT EXECUTED` |
| 8.3 | Try to change the payout wallet via profile edit | Refused — it cannot be mass-assigned | `NOT EXECUTED` |
| 8.4 | Create a service, then a Pass | Both save as drafts | `NOT EXECUTED` |
| 8.5 | Publish before payout verification | Refused with a clear reason | `NOT EXECUTED` |
| 8.6 | Publish after verification | Succeeds | `NOT EXECUTED` |
| 8.7 | **Find it in public Discover** | Appears with no developer intervention | `NOT EXECUTED` |

## 9. Platform matrix

| Platform | Scanner decode path | Status |
|---|---|---|
| Android / Nimiq Pay WebView | Native `BarcodeDetector` (Chromium) | `NOT EXECUTED` |
| **iOS / Nimiq Pay WKWebView** | **`qr-scanner` fallback — Safari has no `BarcodeDetector`.** This is the path most likely to surprise; test it explicitly | `NOT EXECUTED` |
| Desktop Chrome | Native | `NOT EXECUTED` |
| Desktop Safari | `qr-scanner` fallback | `NOT EXECUTED` |

## 10. Evidence template

Record per `PASS` row, or the row does not count:

```
Row:          6.4
Date:         2026-09-__
Device:       iPhone 13, iOS 18.x
App:          Nimiq Pay <version>
Network:      Testnet
Frontend:     http://192.168.1.105:5173  (commit <sha>)
Backend:      http://192.168.1.105:8080  (commit <sha>, NETWORK=TESTNET)
Observed:     Scanned in ~1s; lookup returned "Personal Training / Session 4";
              no session consumed until Confirm was tapped.
```

---

## Known environment limits

- **LAN HTTP is not a secure context.** `getUserMedia` is unavailable, so rows
  6.3–6.4 cannot be walked over `http://<lan-ip>`. To test scanning, serve the
  frontend over HTTPS (a tunnel, or a local certificate) — otherwise the
  provider screen correctly reports "Camera scanning needs a secure (HTTPS)
  connection" and only the typed path (6.10) is walkable.
- `crypto.randomUUID()` is also unavailable there; `createIdempotencyKey()`
  already falls back to `crypto.getRandomValues()`.
- Purchase QR uses the official `nimiqpay://miniapp?url=...` opener, with only
  a purchase page URL. On LAN, both devices must reach the same Wi-Fi host.
  Scanner/deep-link behavior is still a real-device check; Custom URL is the
  manual fallback. The launcher supplies the LAN origin even on localhost.
- Authenticate on the phone with the same customer wallet as desktop. Review
  backend terms, check the selected wallet, explicitly confirm Pay's network,
  then approve. A wrong sender never receives a purchased Pass.
- Do not retry payment after a lost wallet response. The backend dispatch lock
  persists across reloads/devices. A saved hash can be resubmitted; otherwise
  investigate the wallet transaction history and submit its hash or escalate.
  The existing submission TTL still applies; no automatic unlock was added.
- **Never test routine flows against mainnet.**
