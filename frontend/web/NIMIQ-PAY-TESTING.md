# Testing Nimpass inside Nimiq Pay

Derived from the official Nimiq documentation:

- [Load a Local Mini App](https://nimiq.dev/mini-apps/development/load-local-mini-app)
- [Nimiq Provider API](https://nimiq.dev/mini-apps/api-reference/nimiq-provider)
- [Mini Apps overview](https://nimiq.dev/mini-apps)
- [Mini Apps FAQ](https://nimiq.dev/mini-apps/faq)

Desktop-browser testing is not sufficient. Nimpass only meets the Nimiq provider
in the Nimiq Pay WebView, so the wallet half of the product is unverified until
this list has been walked on a real device.

## Execution status

> **Nothing in the checklist below has been executed.**
>
> It is a procedure, not a record. No step here has been run on a device, and no
> row may be reported as passing until someone walks it in Nimiq Pay on testnet
> (docs/04-NIMIQ-MINI-APPS.md §50, docs/05-NIMIQ-PAY-INTEGRATION.md §147).
>
> The automated suite covers the same *logic* against a test double at the SDK
> boundary. That is deliberately not the same claim: it proves Nimpass reacts
> correctly to what a provider returns, not that the real provider returns it.

Setup facts below were re-verified against the current Developer Center
(September 2026): the `init({ timeout })` option, the six provider methods
Nimpass uses, the two documented error names, the hidden dev-menu long-press,
and the testnet faucet amount.

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
4. **Backend CORS.** The backend must allow the mini app's origin
   (`http://<lan-ip>:5173`) in `Access-Control-Allow-Origin`, and allow
   credentials, since the session is a cookie.

   The Go backend allows `Content-Type, X-CSRF-Token, Idempotency-Key` in
   `Access-Control-Allow-Headers` and echoes a single configured origin
   (`config.PublicOrigin`, `internal/httpapi/api.go`). For device testing that
   origin must be set to the Network URL (`http://<lan-ip>:5173`) — any other
   origin is refused outright on preflight.
5. **Open in Nimiq Pay:** Nimiq Pay → Mini Apps → Custom URL → the Network URL.
6. **Switch to testnet:** open the app menu and long-press the settings button
   for 10 seconds. Choose **Testnet**. Switching clears transaction history and
   reloads the app. The switch affects Nimiq operations only.
7. **Fund the wallet:** on testnet, the home empty state (and the Top Up modal)
   shows **Get free NIM** — 110,000 testnet NIM per request.

## Checklist

### Runtime and public browsing

| # | Check | Expected |
|---|---|---|
| 1 | Open the Network URL in Nimiq Pay | Nimpass shell loads; no wallet prompt on page load |
| 2 | Browse Discover, a provider, a package | Everything readable with no dialogs |
| 3 | Provider initialization | Wallet control shows **Sign in**, not "Wallet" |
| 4 | Safe area, top | Header and wallet control clear the status bar and notch |
| 5 | Safe area, bottom | Sticky purchase bar clears the home indicator |
| 6 | Rotate / resize | No horizontal scrolling on any customer screen; landscape notches do not clip content |
| 6a | Document language | `<html lang>` matches the Nimiq Pay language setting where Nimpass supports it (English only today, so `en`) |

### Authentication

| # | Check | Expected |
|---|---|---|
| 7 | Tap Sign in → Continue in Nimiq Pay | Native account dialog appears |
| 8 | Dismiss that dialog | "Sign-in cancelled", no error styling, retry offered |
| 9 | Approve account access | Flow advances to the signing step |
| 10 | Signing dialog | Copy states it is a signature and no NIM is sent |
| 11 | Dismiss the signing dialog | "Sign-in cancelled", still usable |
| 12 | Approve the signature | Session established; header shows the shortened address |
| 13 | Reload the WebView | Session recovers without any new dialog |
| 14 | Background the app during a dialog, return | Flow resumes or cancels cleanly; no stuck spinner |
| 15 | Sign in, then tap Buy before approving | Second request refused with "finish the request already open" — never two stacked native dialogs |
| 16 | Sign out | Session cleared; passes no longer listed |

### Payment

| # | Check | Expected |
|---|---|---|
| 17 | Open a package → Buy with NIM | Native payment dialog with the backend's exact amount and recipient |
| 18 | Compare displayed price to dialog amount | Identical; the dialog amount comes from the purchase intent, not the page |
| 19 | Dismiss the payment dialog | "Payment cancelled · You were not charged", retry offered |
| 20 | Approve the payment | "Confirming your payment…", with "Do not send another payment" |
| 21 | Wait for backend verification | Advances to "Payment successful" only after the backend confirms |
| 22 | Reload mid-verification | Purchase resumes from `?purchase=…`; Buy stays disabled; no second payment offered |
| 23 | Back, then forward, mid-verification | Same as above — recovery, not a new intent |
| 24 | Airplane mode mid-verification | "Checking your payment…", never "failed", no retry button |
| 25 | Double-tap Buy | Exactly one purchase intent and one native dialog |
| 26 | Confirmed payment, pass not yet created | "Payment received · You do not need to pay again"; no "View pass" until it exists |

### Pass and redemption

| # | Check | Expected |
|---|---|---|
| 27 | My Passes | Shows the pass the backend provisioned, with real session counts |
| 28 | Pass Detail | Snapshot, remaining sessions and history come from the backend |
| 29 | Use a session | Code and QR appear; remaining count does **not** change |
| 30 | Leave the code on screen until it expires | "This code expired. No session was used." |
| 31 | Close and reopen the sheet | No session consumed by opening or closing |
| 32 | Provider: Workspace → Redeem | Reachable in one tap from the workspace nav |
| 33 | Provider: open Redeem | No camera permission prompt until **Start scanning** is tapped |
| 34 | Provider: tap Start scanning, then deny | "Camera access was blocked… type the code instead" |
| 35 | Provider: type a code instead | Works without ever touching the camera |
| 36 | Provider: confirm a session | Remaining count comes back from the backend, not `n - 1` |
| 37 | Provider: scan the same code twice | Second attempt is refused; exactly one session consumed |

### Keyboard and layout

| # | Check | Expected |
|---|---|---|
| 38 | Provider forms with the keyboard open | Fields stay reachable; submit button not obscured |
| 39 | Session-code field with the keyboard open | Field and Look up button both reachable |
| 40 | Touch targets | Every interactive control comfortably tappable — buttons, filter pills, dialog and sheet close controls are ≥44px on the phone |
| 41 | Browser → Nimiq Pay handoff | On a *public* URL in a mobile browser, a package page offers **Open in Nimiq Pay** and it lands on the same package, not the homepage. Not testable from the LAN dev URL, where the handoff is deliberately not offered |

## Blocked steps

These cannot be walked yet, because the backend endpoints do not exist
(`backend/internal/httpapi/router.go` currently exposes auth and catalog only):

- **17-26** need purchase endpoints (`POST /purchases`, `/submission`,
  `/reconcile`, `GET /purchases/{id}`).
- **27-31** need pass endpoints (`GET /me/passes`, `/me/passes/{id}`, history).
- **32-37** need redemption endpoints, including the challenge lookup the
  provider screen calls — which has no documented contract at all yet.

Steps 1-16 and 38-40 are walkable today against the existing auth and catalog
endpoints, **once the `{ data }` envelope and the challenge/session field-name
mismatches are resolved** — see the open-contract list in the Milestone 3.5
report. Until then the frontend cannot parse any successful response.

## Notes

- `crypto.randomUUID()` is unavailable over LAN HTTP (not a secure context).
  `createIdempotencyKey()` already falls back to `crypto.getRandomValues()`.
- Camera scanning also needs a secure context. Over LAN HTTP the provider
  screen reports "Camera scanning needs a secure (HTTPS) connection" and the
  typed-code path carries the flow — so step 35 is testable on LAN, step 33-34
  may not be.
- QR decoding uses the platform `BarcodeDetector`. Where the WebView does not
  expose it, scanning reports "unsupported" and typing is the path. That is a
  deliberate choice not to ship a WASM decoder (docs/08-ARCHITECTURE.md §122).
- Never test routine flows against mainnet.
