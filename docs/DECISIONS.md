# Nimpass — Architecture Decision Records

> **Document type:** Accepted decision log
> **Status:** Active
> **Rule:** An accepted decision here is not changed without an explicit instruction. A new decision supersedes an old one by reference; it does not edit it away.

---

## ADR-001 — Two wallet transports behind one abstraction

**Date:** September 2026
**Status:** Accepted
**Supersedes:** the blanket prohibition previously in `08-ARCHITECTURE.md §88`
**Affects:** `08-ARCHITECTURE.md §7, §16, §17, §86, §88, §153`, `frontend/web/src/lib/nimiq/**`, `backend/openapi.yaml`, `backend/internal/nimiq/verify.go`

### Problem

Nimpass is web-first and Mini-App-compatible (`04-NIMIQ-MINI-APPS.md §6`), but the frontend treated "not inside Nimiq Pay" as "no wallet exists". In an ordinary desktop browser:

- Login only explained that Nimiq Pay was required,
- Buy with NIM was either disabled or replaced by a handoff link,
- no customer could authenticate or pay without a phone.

That contradicts §6 directly. Half the declared product had no wallet.

### Why the existing architecture could not solve it

The Mini App SDK's `init()` only resolves inside the Nimiq Pay WebView. There is no configuration, timeout or retry that produces a provider in a desktop browser, because none is injected. Reaching a wallet outside the host requires a different official Nimiq surface.

### Decision

Introduce one wallet abstraction with two implementations:

```text
Nimpass UI
   |
WalletTransport            src/lib/nimiq/transport.ts
   |
   +-- MiniAppTransport    @nimiq/mini-app-sdk   (inside Nimiq Pay)
   |
   +-- HubTransport        @nimiq/hub-api        (ordinary browser)
```

Runtime selection lives in `wallet-runtime.ts` and nowhere else. Nimiq Pay is detected first and always wins, so a Mini App session never sees a Hub window; the Hub fills only the runtime that previously had no wallet.

Authentication, the purchase lifecycle, backend contracts, pass creation, redemption rules and the security model are unchanged and shared. Only the transport differs.

### Hub methods used

`chooseAddress()`, `signMessage()`, `checkout()`. The restricted account-management methods (`login()`, `signup()`, `onboard()`, `export()`) are deliberately not used: they are limited to Nimiq's own origins, and a third-party application authenticates with choose + sign.

Endpoints follow the configured network — `https://hub.nimiq.com` for mainnet, `https://hub.nimiq-testnet.com` for testnet. `VITE_NIMIQ_HUB_URL` may override it on testnet only.

### Consequence: one popup per user gesture

The Hub opens a browser window, and the official guidance is to call Hub methods synchronously inside the click, never after an `await` (`https://nimiq.dev/hub/getting-started`). Two things follow, both deliberate:

1. **Backend input travels as a promise.** `HubApi` accepts `Promise<Request>` and opens its window *before* awaiting the arguments, so the auth challenge or the purchase intent can still be in flight when the window appears. The backend remains authoritative for every value; nothing is precomputed or cached to dodge the rule.
2. **Two wallet operations need two clicks.** Sign-in pauses at `WALLET_SELECTED` between choosing an address and signing the challenge, and payout-wallet verification asks for its second signature explicitly. This is a pause in one flow, not a second flow.

Inside Nimiq Pay, native approval sheets have no such rule, and the existing single-gesture flows are unchanged.

### Consequence: `Cross-Origin-Opener-Policy` must stay unset

The Hub documentation states that `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers break Hub popup communication. Neither is set on the frontend today. The API's own `Content-Security-Policy` applies to JSON responses only and is unaffected.

---

## ADR-002 — Payment reference over Hub `checkout()`

**Date:** September 2026
**Status:** Accepted
**Affects:** `05-NIMIQ-PAY-INTEGRATION.md §23-§28, §45`, `frontend/web/src/lib/nimiq/hub-transport.ts`

### Problem

The backend matches an on-chain transaction against the exact UTF-8 bytes of its `NP1:<32 hex>` payment reference (`validateEvidence`, "DATA"). The Mini App carries it via `sendBasicTransactionWithData()`. A Hub payment had to carry the same bytes or every desktop purchase would fail verification — and removing the reference was never an option, because `recipient + amount` alone cannot identify a purchase (`05 §70`).

### Investigation

`NimiqCheckoutRequest` (version 1) accepts:

```text
recipient          string
value              number   (Luna)
extraData          Uint8Array | string
sender             string   (optional)
forceSender        boolean  (optional)
fee, flags, recipientType, validityDuration  (optional)
```

and returns `SignedTransaction`, including `hash`. The Hub **relays the signed transaction to the network** as part of checkout and also returns it to the caller — so the hash Nimpass reports is for a transaction that has actually been broadcast, exactly as with the Mini App provider.

### Decision

Use `checkout()`. `signTransaction()` was considered and rejected: it does not broadcast, and Nimpass has no Nimiq network client of its own to relay with — adding one would be a new infrastructure dependency for no security gain.

The reference is passed as **bytes**, not as a string:

```ts
extraData: new TextEncoder().encode(paymentRequest.data)
```

`extraData` accepts either, but encoding here leaves the Hub nothing to interpret and guarantees the 36 bytes the backend compares against.

`sender` is set to `Purchase.customerWallet` with `forceSender: true`. The backend already requires the transaction sender to equal the wallet the intent was issued for; forcing it means a mismatch is refused **before** the money moves rather than discovered after.

`fee`, `validityDuration`, `flags` and `recipientType` are left unset, per `05 §29-§30`. The defaults are also what make this the basic transaction the backend's verification requires (`toType`/`flags` zero). *Superseded in part by ADR-014: the **sender's** account type is no longer a verification input, because Nimiq Pay may pay out of an HTLC. `toType` and `flags` must still be zero.*

### What did not change

No verification was weakened. The backend still checks network, sender, recipient, exact amount, reference bytes, execution result, inclusion, macro-block finality, hash uniqueness and intent timing. A Hub window that closes successfully proves nothing. *Superseded in part by ADR-021: macro-block finality is still checked, but under the default `inclusion` policy it is checked after the Pass is issued rather than before. Every other item in this list still precedes issuance.*

---

## ADR-003 — The signing scheme travels with the proof

**Date:** September 2026
**Status:** Accepted
**Affects:** `backend/internal/nimiq/verify.go`, `backend/internal/application/auth.go`, `backend/internal/application/redemption.go`, `backend/openapi.yaml` (`Proof`, `PayoutProof`, `RedemptionAuthorization`)

### Problem — a genuine protocol incompatibility

The backend verifies an Ed25519 signature over a deterministic transform of its own challenge message. Hub documents its transform; the native host transform still needs a real-device fixture:

```text
Nimiq Hub    sign(sha256("\x16Nimiq Signed Message:\n" + len + message))   documented
Nimiq Pay    undocumented; @nimiq/mini-app-sdk forwards the message untouched
```

A single deployment-wide scheme cannot be assumed compatible with both. Raw preprocessing rejects documented Hub signatures; native compatibility remains unverified. ADR-005 corrects the earlier unsupported assertion that the two surfaces necessarily differ.

This is the one place the requested feature could not be delivered without a backend contract change.

### Options considered

1. **Try both schemes.** Rejected. It would double the accepted byte strings per challenge with no way to say which one a signature meant.
2. **Bind the scheme to the challenge.** Rejected. A redemption challenge is reusable across a reload, so it can legitimately be created in one runtime and signed in another; the challenge cannot know.
3. **Name the scheme on the proof.** Accepted. The scheme is a property of the *wallet that produced the bytes*, and the proof is where those bytes arrive.

### Decision

`Proof`, `PayoutProof` and `RedemptionAuthorization` gain an optional `signingScheme` of `raw | hub`. Verification applies exactly that one preprocessor. Omitted, the deployment's configured `NIMIQ_SIGNING_SCHEME` applies — so the Mini App path is byte-identical to before the field existed, and `cmd/verify-sign-fixture` remains the way to settle it.

Only the Hub transport declares a scheme, because it is the only one whose preprocessing is documented.

### Why this does not weaken verification

Naming a scheme cannot change *what* is signed. The message is always the server's own challenge, carrying a 32-byte nonce, the expected wallet, the purpose, the network, the environment and an expiry, and it remains single-use, TTL-bound and rate-limited. Both schemes are deterministic functions of exactly that string, so satisfying either still requires the challenge's own wallet to sign that specific message; neither preimage is derivable from the other without the private key. A proof chooses which of two transforms of one message it claims — never which message.

An unknown scheme name is a `400`, never a silent fallback. Every other check — signer derived from the public key, wallet match, purpose, expiry, consumption, failed-attempt counting — is untouched.

### Not done

No migration and no stored state. The scheme is not persisted, because it describes a signature that has already been verified, not a fact about the challenge.

---

## ADR-004 — Pass is the product; Package is not a product type

**Date:** September 2026
**Status:** Accepted
**Affects:** `01-PRODUCT.md` §1, §3, §4, §17–§21, §59–§60; `02-USER-FLOWS.md`; `03-DESIGN-SYSTEM.md`; `08-ARCHITECTURE.md` §33–§36; `05-NIMIQ-PAY-INTEGRATION.md` snapshot sections; `backend/migrations/000011_pass_product.up.sql`; `backend/openapi.yaml`; frontend catalog and provider routes

### Problem

Nimpass treated Package as the sellable catalog item and Pass as the customer's purchased copy. That split leaked into API paths, table names, UI copy (`Create Package`, `Package Details`) and the mental model itself. The product people actually buy is the Pass — `10 Guitar Lessons`, `8 Personal Training Sessions` — not a Package that later becomes a Pass.

### Decision

**Pass is the sellable product.** A provider uses Create Pass, may keep a draft, and publishes it to Discover. A customer buys that Pass, then uses its sessions. Category classifies Passes for discovery; it is not a new product layer.

Internally, a purchase still freezes terms and gives the customer an independent session balance. That record is a **purchased pass** (`purchased_passes`, `PurchasedPass` in the API). Customers see it as **My Pass**. Product language, UI and public copy must not call the catalog item a Package, and must not teach Package → Pass conversion.

```text
Provider creates a Pass
  → publishes the Pass
  → customer buys the Pass
  → customer uses its sessions
```

### Schema and API

Historical migrations `000001`–`000010` keep their original names. `000011_pass_product` renames live tables:

* `packages` → `passes` (catalog)
* `passes` → `purchased_passes` (owned instances)
* `package_id` / `package_title_snapshot` → `pass_id` / `pass_title_snapshot`
* compensation reason `PACKAGE_EXPIRED_BEFORE_ACTIVATION` → `PASS_EXPIRED_BEFORE_ACTIVATION`

Public catalog is `GET /public/passes`. Provider catalog is `GET /providers/{id}/passes` and `POST /providers/{id}/services/{serviceId}/passes`. The customer's owned collection remains `GET /passes`. A purchase response has `passId` (the catalog Pass) and `purchasedPassId` (the owned instance, once issued).

Frontend routes: `/pass/:id` is the public Pass; `/passes` and `/passes/:id` are My Passes; `/provider/passes` is the provider catalog. `/packages` redirects for old links.

### What did not change

* Snapshot at purchase still wins over later edits to the live Pass (`01` §19).
* Service remains the activity / type a Pass belongs to. Category is stored on the service and inherited by its current public Passes.
* Wallet transports, payment verification and redemption rules are unchanged.


---

## ADR-005 — Desktop purchase handoff to native Nimiq Pay

**Date:** 2026-09-16

**Status:** Accepted by the user's explicit QR handoff instruction. The QR
payload alone is under revision by ADR-006; everything else here stands.

**Supersedes:** ADR-002's Hub checkout as the primary desktop payment flow.

Desktop authenticates through the official network-specific Hub, creates a
backend purchase intent, and displays a QR containing the official Mini App
opener and `/purchases/{purchaseID}`. Hub address selection alone is not login.
After proof verification the browser must recover the cookie-backed session
before private UI unlocks. Failed server logout remains visible and signed in.

The purchase UUID is a locator, not a bearer credential. Phone access requires
an authenticated session for the same customer wallet. The phone reloads all
terms from the backend, asks for explicit native approval, sends the exact
recipient/value/NP1 data, and reports only the hash. The existing verifier still
checks expected sender, network, recipient, exact value/data, timing, execution,
finality and uniqueness. Ownership is never silently reassigned to the payer.
Both surfaces watch one backend lifecycle; verified settlement creates one
purchased Pass under ADR-004's terminology.

Before calling the wallet, an owner-scoped database transaction grants one
wallet dispatch. Replays and concurrent devices conflict. A possible dispatch
hides payment instructions, prevents cancellation/new intent creation for that
customer/product, and remains uncertain after expiry. Only the initiating
attempt may report definite pre-broadcast rejection and release the lock; no
candidate evidence may exist. Unknown outcomes never unlock automatically.
This is duplicate-payment protection for cooperating clients, not payment proof.
A client-supplied cancellation cannot create a Pass or change verified terms.

The installed SDK/current official API does not expose the native wallet's NIM
Testnet/Mainnet selection or a sender-pinning payment parameter. `getNetwork()`
returns the provider namespace. Users explicitly check the selected wallet and
network before payment; backend verification rejects mismatches. This cannot
undo a wrong-chain/wrong-sender transfer. Real-device approval behavior and
message-signing preprocessing remain release checks. ADR-003's categorical
claim that native and Hub preprocessing necessarily differ is unproven; only
Hub's envelope is documented. No verification fallback is introduced.

Account selection and login signing are separate actions in both runtimes.
Payout and owner roles use one fresh proof when their wallet is identical;
different wallets require two explicit steps so the user can change signer.
Backend verification of both roles is unchanged.

Configuration must name environment/network explicitly: development/test uses
TESTNET; production uses MAINNET. Frontend operations compare API config before
signing/payment. The local launcher alone supplies a same-origin Vite API proxy
and canonical LAN origin, preserving HttpOnly cookies on localhost and LAN.
Foreign origins are not rewritten; production forbids the local proxy.

Sources: [Mini App openers](https://nimiq.dev/mini-apps),
[Nimiq provider](https://nimiq.dev/mini-apps/api-reference/nimiq-provider),
[Hub authentication](https://nimiq.dev/hub/guide/accounts),
[local Testnet](https://nimiq.dev/mini-apps/development/load-local-mini-app).


---

## ADR-006 — The purchase QR is a payment request, not a Mini App locator

**Date:** 2026-09-16

**Status:** **Adopted**, superseding the gated state below. G2 is cleared in
full (server-side discovery is implemented; see ADR-010). G1 remains unmeasured
on a device, and ADR-010 states the rule that makes shipping safe without it
rather than waiting for it. The gate text below is kept as written for the
record; read it together with ADR-010.

**Revises:** ADR-005, for the QR payload only.

**Affects:** `docs/NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md`,
`frontend/web/src/lib/nimiq/**`, `frontend/web/src/components/payment/**`,
`backend/internal/nimiq/rpc.go`, `backend/internal/application/payment.go`

### Problem

ADR-005 put a Mini App opener in the desktop purchase QR. The customer's
instinct — and the product we want — is the ordinary crypto-payment gesture:
open Nimiq Pay, tap Pay, scan, confirm. A Mini App locator cannot serve that
gesture. Nimiq Pay's payment scanner rejects it outright ("Invalid link format.
Only CPLinks and NAKA requests…"), and even when the locator is opened the
right way it routes the customer through logging into Nimpass again on the
phone before any money can move.

### Decision

Two different objects, never one:

```text
MiniAppLink        navigation: continue this Nimpass page inside Nimiq Pay
                   nimiqpay://miniapp?url=…  |  https://nimpay.app/miniapps/open/…

PurchasePaymentQR  payment: a Nimiq payment request built only from the
                   backend's authoritative paymentRequest
                   recipient · exact value · NP1 reference · network
```

They never substitute for each other, and the payment QR never carries a
Nimpass URL.

The target flow is: desktop creates the Purchase Intent → desktop shows the
payment request as a QR → Nimiq Pay scans it → the customer confirms a
transaction the wallet itself prepared → the backend **discovers** the
transaction on chain by `(recipient, NP1)` and runs the unchanged verifier →
finality → Pass → the desktop, already polling, updates itself. *Per ADR-021
the last two steps swapped: canonical inclusion and the full verifier issue the
Pass, and finality follows in the background. Discovery is unaffected — it is
the same verifier either way.*

### Gates

This decision is not implementable on evidence available today, so it is
recorded with its conditions rather than half-built:

- **G1 — scanner capability.** No official document states which QR payloads
  the Nimiq Pay scanner accepts, and the app's own strings contradict each
  other. `frontend/web/scripts/nimiq-pay-scan-probe.mjs` measures it on a
  device. Scanner-first requires an accepted format whose `message` arrives in
  the transaction's `recipientData` as the exact 36 ASCII bytes of `NP1:…`.
- **G2 — backend discovery.** Verification today begins from a hash a client
  reported (`application/payment.go:86`, `database/payment.go:18`,
  `nimiq/rpc.go:155`). In a scanner-first payment nobody reports one. The
  additive backend work is specified in the investigation document §5.

Until both clear, the desktop QR stays a Mini App locator and its copy sends
the customer to the phone camera, because shipping a payment QR the backend
cannot see would mean real money with no Pass, no receipt and no compensation
case.

### What does not change

Server authority. The Purchase Intent still snapshots recipient, exact Luna
value, network, sessions, expiry and the reference, and the QR is rendered from
that DTO only — never from a frontend-computed price. `paymentRequest` remains
non-null only while `awaiting_payment`, so a confirmed, expired, cancelled or
compensation-bound purchase cannot produce a payable QR. The verifier keeps
every check it has: sender equals the expected wallet, recipient, exact value,
`NP1` bytes, network, execution, inclusion, macro finality, hash uniqueness,
timing and one-Pass issuance. A scan, an approval or a client-supplied hash
remains a hint, never a settlement. *ADR-021 moved macro finality behind
issuance under the `inclusion` policy; it did not remove it, and nothing else
in this list moved.*

Sources: [Request link encoding](https://nimiq.dev/nimiq-utils/request-link-encoding),
[`RequestLinkEncoding.ts`](https://github.com/nimiq/nimiq-utils/blob/master/src/request-link-encoding/RequestLinkEncoding.ts),
[Mini App openers](https://nimiq.dev/mini-apps),
[PoS JSON-RPC `getTransactionsByAddress`](https://nimiq.dev/rpc/methods/get-transactions-by-address),
device observation 2026-09-16 (see the investigation document).

---

## ADR-007 — Sessions are spent by the pass owner, not confirmed by the provider

**Date:** September 2026
**Status:** Accepted
**Supersedes:** the two-party redemption model in `01-PRODUCT.md §24-§26`, the provider redemption flow in `02-USER-FLOWS.md §49-§54`, and the Session Confirmation section of `03-DESIGN-SYSTEM.md`
**Affects:** `backend/internal/application/redemption.go`, `backend/internal/database/redemption.go`, `backend/internal/httpapi/{router,redemption_handlers}.go`, `backend/openapi.yaml`, `frontend/web/src/hooks/use-redemption.ts`, `frontend/web/src/types/redemption.ts`, `frontend/web/src/components/pass/redemption-sheet.tsx`, `frontend/web/src/api/redemptions.ts`

### Problem

Redemption was a four-step ceremony across two devices:

```text
1. customer  POST /passes/{id}/redemption-challenges
2. customer  POST /redemption-challenges/{id}/authorization   -> NR1:<token>
3. provider  POST /providers/{pid}/redemptions/lookup
4. provider  POST /providers/{pid}/redemptions/confirm        -> session consumed
```

Only step 4 moved a counter, and it was gated on the provider's identity
owning the provider record. The product wanted a customer who buys a Pass to
own it outright and use it from their own account, without a provider opening
an operational screen, pointing a camera at a phone, or typing a code.

### Why the frontend could not solve it

Deleting the provider's redemption screen would have left the backend with no
reachable path to consume a session at all: the customer's own signature
authorised a challenge but never spent it. This is a domain change, not a route
removal.

### Decision

Authorising **is** the redemption. `POST /redemption-challenges/{id}/authorization`
verifies the owner's signature and consumes exactly one session in the same
locked transaction. The provider's `lookup` and `confirm` endpoints are removed,
along with the `NR1` bearer reference, its rotation path, and the QR surfaces on
both sides.

```text
1. owner  POST /passes/{id}/redemption-challenges
2. owner  POST /redemption-challenges/{id}/authorization   -> session consumed
```

### What is deliberately unchanged

Every security property that did not depend on a second party:

- The backend authors the canonical message; the client never composes it.
- One fresh Ed25519 signature over `Purpose: AUTHORIZE_REDEMPTION`, bound to the
  challenge, pass, provider, wallet, network, environment, nonce and the
  **expected session counts**.
- One active challenge per pass, a five-minute TTL, and a stale-context check
  that refuses a signature made against counts that have since moved.
- Consumption stays one PostgreSQL transaction under `FOR UPDATE` row locks, so
  concurrent submissions spend exactly one session
  (`TestConcurrentRedemptionAuthorizationIsSingleUse`).
- The `redemptions`, `redemption_challenges` and `redemption_events` tables are
  unchanged — no migration — and every redemption still records its provider, so
  `GET /providers/{id}/redemptions` keeps working.
- Payment verification and payout-wallet verification are untouched.

### Accepted consequence

The provider loses the guarantee that a session was actually delivered. A
customer can spend ten sessions in ten taps without attending anything. The Pass
changes from a card the provider punches to a card the customer punches, and the
product is now trusting the customer with their own balance. This was weighed
and accepted as a deliberate product trade, not overlooked.

The UI carries the weight that the provider used to: the confirmation step says
plainly that confirming uses the session straight away and that there is no
undo, because it is now the only thing standing between a stray tap and a spent
session.

---

## ADR-008 — Creating a Pass is the provider experience; there is no workspace

**Date:** September 2026
**Status:** Accepted
**Supersedes:** `01-PRODUCT.md §30` (Provider Workspace), the Provider Overview and Provider Passes sections of `03-DESIGN-SYSTEM.md`
**Affects:** `frontend/web/src/app/router.tsx`, `frontend/web/src/pages/provider/**`, `frontend/web/src/components/layout/provider-shell.tsx` (removed), `frontend/web/src/components/provider/payout-panel.tsx`, `frontend/web/src/hooks/use-provider-workspace.ts`

### Problem

The provider side was a workspace: a persistent sidebar over Redeem, Services,
Passes and Profile. Creating a Pass — the one thing a provider comes to Nimpass
to do — was several screens deep, and a provider with no services hit a dead
end telling them to go and make one first.

### Decision

Remove the workspace shell, the Services screen, the Profile screen and the
Redeem screen. What remains is one form and the list it came from:

```text
Create Pass -> form -> Preview/Edit -> Publish
```

Two things the removed screens owned move into the form rather than disappearing:

1. **The service.** `POST /providers/{id}/services/{serviceId}/passes` still
   requires one, so the form asks what the Pass is for and `useEnsureService`
   creates it — and activates it, because a created service is a DRAFT and
   publishing requires ACTIVE. The domain relation stays; the screen does not.
2. **The payout wallet.** `POST /catalog/passes/{id}/publish` returns 409 without
   a verified payout wallet (`database/catalog.go`), so verification is offered
   inline at the moment Publish is pressed. This is security, not management UI,
   and removing the workspace did not remove it. *Superseded by ADR-025: the
   login wallet is adopted as the payout wallet when the provider record is
   created, so nothing stands in front of Publish. The 409 and the ceremony for
   **changing** a payout wallet are unchanged; the inline panel is gone.*

Publishing moves onto the form too: after Create, the screen stays put in edit
mode and Publish is there.

### Known gap

`Provider.location`, `bio` and `avatarUrl` have no editing surface any more —
they were only on the removed Profile screen. `PATCH /providers/{providerID}`
still accepts them. The Pass form states the location when one is stored and
stays silent when none is, rather than offering an edit it cannot carry out.

---

## ADR-009 — The checkout branches on device class, not on wallet transport

**Date:** 2026-09-16

**Status:** Accepted by the user's explicit instruction ("the payment UX must be
selected based on whether the user is using Nimpass on mobile or desktop…
this is not a provider-detection flow").

**Refines:** ADR-005, which established the desktop locator QR and the native
phone payment. What ADR-005 left implicit — *what selects between them* — is
what this decision names.

**Affects:** `frontend/web/src/lib/checkout-device.ts` (new),
`frontend/web/src/hooks/use-checkout-device.ts` (new),
`frontend/web/src/components/payment/**`, `docs/08-ARCHITECTURE.md §15-§17, §88`

### Problem

The checkout chose its shape from `capabilities.transport`: `mini-app` got the
native review, everything else got a handoff panel. That is provider detection,
and it answers the wrong question. "Is a Nimiq provider injected here?" is a
runtime fact about the wallet; "is this a phone or a laptop?" is the question
the payment *experience* actually turns on, and the two only coincide by
accident. A phone browsing `nimpass.app` outside Nimiq Pay has no provider and
was shown desktop copy; the distinction also put the branch in a component that
read wallet state, so nothing named the rule or could test it.

### Decision

One shared, pure classifier decides one thing:

```text
type CheckoutDevice = 'mobile' | 'desktop'
```

It reads ordinary browser signals — user-agent, `userAgentData.mobile`,
`maxTouchPoints`, pointer coarseness, viewport — in a fixed order, and returns
`desktop` when they are inconclusive. `useCheckoutDevice()` is the only way the
application asks. No component performs its own viewport or user-agent check to
decide how a purchase is paid.

```text
Buy Pass -> create/recover the Purchase Intent -> classify the device
   mobile  -> sendBasicTransactionWithData()  (official Nimiq provider)
   desktop -> QR modal; the phone pays the SAME intent
```

The intent is always created **first**. The branch cannot change a term,
because by the time it runs every term is already snapshotted server-side.

### Three things the classifier deliberately does

**Reads `insideNimiqPay` as a device signal.** Nimiq Pay is a phone
application, so its WebView is conclusive evidence about the hardware — and the
one signal a desktop's device-emulation mode cannot forge. This is not the
branch reading the provider: the provider does not choose the flow, and the
flag is passed in as a plain boolean so the rules stay a pure function.

**Classifies tablets as mobile.** The question being answered is "can this
device run Nimiq Pay and confirm natively?", and Nimiq Pay ships for iPad and
Android tablets. An iPad in "Request Desktop Website" mode sends a Macintosh
user-agent, so touch points separate it from a real Mac — without that rule,
every such iPad is handed a QR code to scan with itself.

**Defaults to desktop.** The two mistakes are not symmetrical. A desktop shown
the QR is one hop from paying. A phone-less desktop shown "Approve in Nimiq
Pay" is a dead end, because there is no provider to call.

### What it is never used for

Identity, permissions, Pass ownership, authorisation, or any decision the
backend makes. Device class is a UX router. A customer who forges every signal
in this module gains one differently-shaped screen and no payment advantage:
the backend still snapshots the terms, still verifies the transaction against
the chain, still requires the sender to equal the intent's wallet, still
requires canonical inclusion and — per the configured confirmation policy
(ADR-021) — still tracks finality, and still issues the Pass itself.

`requestDeviceIdentifier()` is not used. It identifies a device without
classifying it, and it prompts the customer for consent to answer a question it
cannot answer.

### The mobile branch has a second, narrower question

Once a device is `mobile`, it still matters whether the transaction can be
initiated *here*:

```text
mobile + injected provider  -> native review -> sendBasicTransactionWithData()
mobile + ordinary browser   -> tap the documented opener; Nimiq Pay pays
```

This is not a third flow. It is the same handoff the desktop QR performs,
addressed to the device already in the customer's hand — no QR, because the
device that would scan it is the device displaying it.

### What did not change

Everything below the branch. One Purchase Intent domain, one recipient and
price snapshot, one `NP1:` reference, one network, one submission endpoint, one
verification pipeline, one finality rule, one Pass issuance, one set of
idempotency and duplicate protections. The desktop QR remains ADR-005's Mini
App locator carrying a purchase UUID and nothing else; ADR-006's payment-request
QR remains gated on its two unmet verifications.

### Noted tension

`08-ARCHITECTURE.md §88` still forbids "treating *Open in Nimiq Pay* as the
desktop wallet solution". ADR-005 superseded that for the purchase flow on the
user's explicit instruction, and this mission reaffirmed it. The prohibition's
real target — a second, parallel business flow for desktop — is untouched and
is what §"What did not change" above exists to guarantee. Recorded rather than
silently resolved.

---

## ADR-010 — The QR is a payment request the server finds on chain

**Date:** 2026-09-16

**Status:** Accepted by the user's explicit instruction to adopt the payment-QR
checkout and to implement server-side blockchain reconciliation for it.

**Supersedes:** ADR-006's gating (G2 is now implemented), ADR-009's
device-first checkout branch, and — narrowly and explicitly — the
unconditional payment-reference rule in `05-NIMIQ-PAY-INTEGRATION.md §45` and
its Invariant 11.

**Affects:** `backend/internal/nimiq/{rpc,request_link}.go`,
`backend/internal/application/payment.go`,
`backend/internal/database/payment.go`,
`backend/migrations/000013_payment_discovery.up.sql`,
`backend/internal/httpapi/payment_handlers.go`, `backend/openapi.yaml`,
`frontend/web/src/lib/{checkout-route,nimiq/payment-uri}.ts`,
`frontend/web/src/components/payment/**`

### What changed

Three things, each of which was previously blocked on a different reason.

**1. The desktop QR carries the payment, not a locator.** The backend renders
`nimiq:<recipient>?amount=<decimal NIM>&message=<NP1>` from the Purchase
Intent's snapshot and ships it as `paymentRequest.uri`. The browser encodes
that string and nothing else; `verifiedPaymentUri()` re-reads it and withholds
the code unless its recipient and amount match the DTO's own fields. `amount`
is decimal NIM because the official encoder divides Luna by 100,000 — encoding
Luna would open the customer's wallet on 100,000× the price.

**2. The backend discovers payments nobody reports.** `getTransactionsByAddress`
on the intent's recipient, swept by the existing reconciler with its own
backoff. A transaction is adopted only when sender, recipient, exact Luna
value, network and timing all match, and then goes through the *unchanged*
`Inspect` → `validateEvidence` → settlement policy → `Confirm` path. Discovery
nominates a hash; it never decides one is good. This is ADR-006's G2,
implemented. *That path read `→ finality →` until ADR-021 made the step a
configured policy. Both entry points — a reported hash and a discovered one —
still converge on the same verifier and the same policy.*

**3. The checkout branches on capability, then on device.** `transport ===
'mini-app'` decides whether a transaction can start here at all; the device
class only shapes the handoff when it cannot. ADR-009 had the device class
first, which meant a phone browsing Nimpass outside Nimiq Pay — phone-shaped,
no provider — could be offered a native checkout with nothing behind it.

### The rule that supersedes §45, stated plainly

`05 §45` and Invariant 11 require the transaction's data field to equal the
intent's payment reference. That rule now reads:

```text
tx data == this intent's NP1   -> may settle this intent
tx data empty                  -> may settle this intent
tx data == any other content    -> never settles this intent
```

**Why the middle line exists.** Nimiq Pay's payment scanner is closed-source,
no official document says a scanned request link's `message` reaches the
transaction's `recipientData`, and the app's own strings contradict each other
(ADR-006 G1, still unmeasured). Under the old rule, a scanner that silently
drops `message` would take a customer's real NIM and produce no Pass, no
receipt and no compensation case. That is a worse failure than the one the rule
was protecting against.

**Why it is not a weakening.** The reference was never the only correlation —
`131` lists six, and every other one still holds exactly as before. A
reference-less transaction is adopted only when it is indistinguishable from
the payment this intent asked for: the expected buyer's wallet as sender, the
provider's snapshotted wallet as recipient, the price to the Luna, the right
network, inside the intent's own lifetime. Replay is unaffected —
`verified_payments.transaction_hash` is still a primary key, so one transaction
settles at most one purchase ever, and the timing window still prevents an
older transaction of the customer's own being presented for a new intent.
Ambiguity is refused rather than guessed: two matching transactions adopt
neither.

**What did not move.** §142's test is untouched and is the third line above: a
transaction carrying reference R2 cannot settle intent R1, whatever else
matches. Wrong amount, wrong recipient, wrong sender and wrong network are all
still outright rejections. 800 NIM never buys a 1000 NIM Pass.

### The mini-app path keeps `sendBasicTransactionWithData()`

The instruction naming `sendBasicTransaction()` is followed in substance —
recipient and Luna value straight from the intent — but not literally. Both
methods are official and take the same `recipient`/`value`; the `WithData`
variant additionally carries the `NP1` reference onto the chain, which is the
strongest correlation Nimpass has and is what `§45`'s first line above is
built on. Dropping it would delete a working security property from the one
path that can guarantee it, to match a method name. Recorded here rather than
silently kept.

### Deployment consequence

Discovery requires an address-indexing **history** node.
`rpc.nimiqwatch.com` documents itself as one. `Payments.Discovery` is optional
and nil-safe: without it the mini-app checkout is unchanged and the QR checkout
simply has no settlement path — a missing feature, never an unsafe one.

`ErrRPCRateLimited` is now distinct from `ErrRPCUnavailable` because the public
endpoint allows 20 tokens per 10 seconds and charges list results per 100
items. Both still mean *uncertain*: a throttled lookup never concludes that a
payment is absent, and never fails a purchase (`05 §95`, `§97`, `§158`).

### Still unverified on a device

G1. Whether Nimiq Pay's scanner accepts this payload, and whether `message`
survives onto the chain. Two things make that survivable rather than blocking:
the Mini App opener sits on the QR screen as a second route to the same intent,
and the reference-optional rule above means a scan that drops `message` still
settles. `frontend/web/scripts/nimiq-pay-scan-probe.mjs` still measures it, and
its result should be recorded in
`NIMIQ-PAYMENT-QR-INVESTIGATION-2026-09-16.md §6`.

---

## ADR-010 — Owner wallet is the public identicon, payout wallet stays private

**Date:** 2026-09-16
**Status:** Accepted
**Affects:** `PublicProvider` in `backend/openapi.yaml`, public pass/provider UI

### Problem

A pass named who sold it with a colour chip of initials (`YS` for "Your Studio").
The same wallet's Profile and header already show the official Nimiq identicon.
Customers therefore met a second, invented face for the person they were about
to pay.

### Decision

`PublicProvider.wallet` is the **owner identity** address. The UI uses it only
to render `@nimiq/identicons`. The address is not printed as copy
(`docs/03-DESIGN-SYSTEM.md` §92). `payoutWallet` remains owner-only and is
never on the public DTO.

The display name stays `Provider.name`. Providers edit it on Profile; that is
the string "Provided by" shows on every pass they publish.

---

## ADR-011 — A provider picks their face from their own wallet's identicons

**Date:** 2026-09-17
**Status:** Accepted
**Affects:** `providers.avatar_variant`, `ProviderInput` / `Provider` /
`PublicProvider` in `backend/openapi.yaml`, `AvatarPicker` on Profile

### Problem

ADR-010 gives every provider one face: the identicon of the wallet that owns
the profile. It is a real Nimiq identity rather than an invented mark, and it
is not a choice — a provider who dislikes the face Nimiq drew for their address
has no way to change it short of uploading a photograph to an external HTTPS
host, which Nimpass neither offers nor hosts.

Nimiq publishes no catalogue of ready-made avatars to pick from instead. An
identicon is *generated* from a string, out of an asset set of 21 faces, 21
tops, 21 sides, 21 bottoms and 10 colour pairs.

### Decision

The profile stores `avatarVariant`, a number in `0..255`, and the client draws
the identicon of the seed `address` (variant 0) or `address#N`.

- **0 is the wallet's own identicon**, so ADR-010 stays the default and every
  existing provider renders exactly as before.
- **Every option is derived from the owner's own address.** A provider chooses
  among faces of their account, never a face that belongs to a different
  wallet.
- **It is a stored public field**, like the display name: the same face is
  served to a logged-out visitor, to another customer, and to the provider.
  Nothing about the face is derived from the session.
- **No upload path.** `avatarUrl` keeps its existing meaning — an external
  HTTPS reference the backend neither fetches nor hosts — and still takes
  precedence when set. Nimpass stores no avatar media.

### Consequences

The wallet identicon is no longer a guarantee of *which* wallet is selling,
only that the face belongs to that wallet's set. It never was such a proof —
1.9M combinations across every Nimiq address means collisions are ordinary —
and the parts of the product that must not be confused about identity (payment
recipient, redemption authority) read the address, never the picture.

---

## ADR-012 — A pass is a list of sessions; a provider cannot buy their own

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-007 (owner-signed redemption stands), ADR-008 (still no
workspace), `01-PRODUCT.md §37` (still not a booking system)
**Affects:** `pass_sessions` and the two identity columns on
`purchased_passes` (migration `000015`), `domain/pass_session.go`,
`domain/pass.go`, `application/pass_session.go`,
`database/pass_session.go`, `GET /passes/{passID}/sessions`,
`PATCH /pass-sessions/{sessionID}/schedule`,
`POST /pass-sessions/{sessionID}/complete`,
`GET /providers/{providerID}/purchased-passes`

### Problem

Three separate gaps, all of them the same missing record.

1. **A session had no identity.** A purchased pass carried
   `used + remaining = original` and nothing else, so "which session was
   that?" had no answer, "when is the next one?" had nowhere to live, and the
   only history was the redemption audit log — which by construction contains
   only sessions that already happened. A pass with seven left showed nothing
   about the seven.
2. **The provider could not see the pass they owed.** `GET /passes/{passID}`
   was owner-scoped, so the two parties to one entitlement had no shared view
   of it. `01-PRODUCT.md §33` promises shared state; there was none.
3. **A provider could buy their own pass.** Nothing at any layer stopped it,
   and the resulting pass would have named the same account as both its buyer
   and its provider.

### Decision

**Sessions are records.** Every session a pass is sold with exists as a row
from the moment the pass does — numbered `1..N`, created in the same
transaction as the pass, never added to and never renumbered. Each carries an
optional date and a status: `UNSCHEDULED`, `SCHEDULED`, `COMPLETED`,
`CANCELLED`.

The counter on `purchased_passes` is **not** replaced by a count over those
rows. It stays, with its `used + remaining = original` and `remaining >= 0`
check constraints, because those constraints are the database-level guarantee
that a session cannot be spent twice or into the negative — a derived count
could not be constrained that way. What is new is the requirement that the two
agree: one COMPLETED row per increment, written in one transaction.

**Both parties read and write the same rows.** A purchased pass now names its
two accounts directly — `owner_identity_id` and `provider_identity_id`,
snapshotted at creation — and every session read and write resolves the caller
against them inside the same statement that takes the lock. The responses
carry `viewerRole`, so no client has to work out which party it is.

**Who may do what, and why it is asymmetric.** Either party may set or clear a
session's date: scheduling is an arrangement between them and moves no
counter. Only the **provider** may mark a session delivered, because the
owner's route to spending one is the wallet signature ADR-007 is built on —
a plain `POST` from the owner would quietly delete that proof from the
product, so it is refused with 403. Both paths end in the same guarded write,
so the records and the counter cannot disagree about who spent what.

**A provider cannot purchase from their own catalogue.** Decided in
`PaymentRepository.Create`, against `providers.owner_identity_id` read under
the same lock that produces the price and the payout wallet, and answered
`403 SELF_PURCHASE_NOT_ALLOWED`. The rule is restated as a domain invariant in
`NewPurchasedPass`, so a pass whose owner is its own provider cannot be
constructed even if an intent somehow survived a change of provider ownership.
The pass page hides the Buy button for that account, which is presentation
only.

### Why this is not a booking system

`01-PRODUCT.md §37` says scheduling is not the problem Nimpass solves, and
that stands. There is no calendar, no availability, no conflict detection, no
reminders, no bookings, and nothing that can be scheduled before it has been
paid for. A session of an already-purchased pass can record *when it is meant
to happen*, and that is the whole of it — the field exists so both parties can
point at the same session, not so anyone can plan a week in it.

### Why this is not a provider workspace

ADR-008 stands. What a provider gains is a list of the passes they sold, on
the page that already lists the passes they made, and the ability to open one
— which leads to the **same** pass screen the customer uses, not a provider
copy of it. One route, one record, one set of sessions. There is no dashboard,
no side navigation and no second information architecture; that identity is
exactly what makes "the provider marked session 3 done" and "the customer sees
session 3 done" one fact instead of two systems agreeing.

### Consequences

The redemption audit trail keeps its meaning and its rows: a signed redemption
still writes a `redemptions` record, and the session it spent now points at
it. A provider-recorded completion has no signature and therefore no
redemption row — its audit facts are the session row and its
`SESSION_COMPLETED` event. Reading provider history and reading a pass's
sessions are consequently two different questions with two different answers,
and the pass screen asks the second.

---

## ADR-013 — A QR payment settles itself, correlated by reference not by sender

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-006 (the QR stays a payment request), ADR-010 (discovery stays
the settlement path, reshaped)
**Affects:** `payment_discovery_cursors` and the owner foreign key (migration
`000016`), `domain/purchase.go`, `domain/pass.go`,
`application/payment.go`, `database/payment.go`, `nimiq/rpc.go`,
`cmd/server/main.go`, the desktop QR modal, `NativeCheckout`,
`ReportTransaction`

### Problem

A desktop QR purchase could be paid correctly and stay `PAYMENT_PENDING`
forever. The customer's only recourse was a form asking them to paste a
transaction hash — which most people cannot find and should never have to.

Four separate causes, all in the discovery path ADR-010 introduced:

1. **The sender was the correlation key.** `matchDiscovered` and
   `validateEvidence` both required the on-chain sender to equal the wallet
   the intent was issued to. Nimiq Pay pays from whichever account the user
   approves and its provider API has no sender parameter, so a customer with
   two accounts could pay perfectly and never be matched.
2. **Discovery was per purchase.** One address query per pending intent. Fifty
   live intents on one provider meant fifty scans of the same list, against a
   public gateway that bills a token per hundred items.
3. **Backoff counted quiet, not failure.** `discovery_attempts` grew on every
   sweep that found nothing — which is the normal state of a customer walking
   to their phone. After four empty looks the interval was four minutes, so
   the slowest period was exactly the one in which the payment lands.
4. **No cursor.** Every sweep re-read and re-examined the same newest hundred
   transactions.

### Decision

**Correlate on the reference; fall back to the sender only without one.**

A transaction carrying this intent's `NP1:` bytes — 16 random bytes the server
generated for this one purchase and disclosed to nobody else — is bound to it
more tightly than an address could bind it. When the reference is present the
sender is *recorded* and no longer *required*. When it is absent nothing
purchase-specific is on chain, so the sender rule stands exactly as it was:
recipient and amount alone would match any stranger's transfer to the same
provider.

Nothing else moves. Recipient, exact Luna, network, execution result,
inclusion, macro-block finality, the settlement window, global hash
uniqueness and the refusal of another purchase's reference are all unchanged,
and a referenced transaction that is wrong in any of them is still refused.
*ADR-021 later changed when macro-block finality is required — after issuance
under the `inclusion` policy — and nothing else in this paragraph.*

**The Pass belongs to the buyer, not to the payer.** `owner_wallet` is now the
authenticated buyer's `expected_wallet` rather than the on-chain sender, and
the composite foreign key follows it. This is what makes the above safe: with
the sender no longer gating the match, letting it decide ownership would hand
a Pass to whichever account happened to pay. The paying address stays in
`verified_sender_wallet` as an audit fact.

**Sweep by address, with a cursor, at a tempo set by whether anyone is
waiting.** `payment_discovery_cursors` holds one row per payout address per
network. A sweep queries each address once, walks the returned list until it
meets the cursor, matches every new transaction against *all* live intents on
that address, and advances the cursor to the head. Backoff counts consecutive
RPC failures only. The reconciler runs every 2 s while any intent is live and
every 30 s otherwise.

### Why polling and not a head-block subscription

The local node does serve WebSocket (`/ws` answers `101`) and
`subscribeForHeadBlock` exists. It was not adopted: against a one-second block
time a two-second poll is the same latency, and the subscription would add a
persistent connection, a reconnect policy and a second code path — while not
working at all against a plain HTTP gateway. This is not a compromise
position; it is the same answer with fewer ways to break.

### Why the QR payload did not change

ADR-006 chose a `nimiq:` payment request over a Mini App locator on measured
evidence: Nimiq Pay's scanner rejects `nimiqpay://miniapp?url=…` with
"Invalid link format". That evidence has not changed, and the request link
already carries the reference as its `message`. The Mini App opener remains
beside the code as the second route to the same intent, and it is now
friction-free — the wallet-confirmation gate on that screen existed only to
protect the sender rule and has gone with it.

### Consequences

The manual hash form stays, demoted: it appears only after 90 seconds of an
unsettled live intent, and a customer on the ordinary path never sees it.

One case remains that automatic discovery cannot settle: a scanner that drops
the request link's `message` **and** a payment approved from an account other
than the signed-in wallet. There is then nothing purchase-specific on chain
and nothing linking the transfer to this customer, and inventing a link would
mean settling one customer's purchase with another's money. That case is what
the manual form is for.

---

## ADR-014 — The sender's account type does not decide whether a payment counts

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-013 (the reference correlates the payment; the payer is an
audit fact), ADR-002 (which described the outgoing transaction shape)
**Affects:** `application/payment.go` (`validateEvidence`, the `EXECUTION`
clause), `docs/05-NIMIQ-PAY-INTEGRATION.md`

### Problem — measured, not anticipated

A purchase made on a real device through Nimiq Pay on 2026-09-17 was paid and
then refused. Two of them, minutes apart: `07f7d85b` (120 NIM) and `3045bbfc`
(1000 NIM). Both reached the provider's address with the exact Luna, both
carried the intent's own `NP1:` bytes in `recipientData`, both executed
(`executionResult: true`) and both were recorded `MISMATCH` / `EXECUTION` and
failed permanently. The customer saw *"The payment didn't match this purchase,
so no pass was created."* while the money was already gone.

The cause was one clause:

```go
tx.FromType == nil || *tx.FromType != 0
```

Nimiq Pay does not always pay from a basic account. On the device measured,
the account's spendable balance sat in an **HTLC** — the buyer's own basic
address `NQ25 HFL4 …` held a balance of 0, and 110,000 NIM had been moved into
the contract `NQ68 1BPD …` (whose `sender` is that same buyer). Payments are
made by early-resolving the contract, so the chain reports `fromType: 2` and a
`from` that is the contract, not the user.

Verified against the local Testnet history node:

```text
getAccountByAddress NQ68 1BPD …   → type "htlc", sender NQ25 HFL4 …, balance 10778000000
getTransactionByHash d512a594…    → fromType 2, toType 0, flags 0, value 12000000,
                                     recipientData "NP1:0b06e5f0…", executionResult true
```

### Decision

**The sender's account type is not a verification input.** The `EXECUTION`
clause keeps every other condition and drops `*tx.FromType != 0`; the
`!= nil` presence check stays, so a transaction the node did not fully
describe is still refused.

### Why this weakens nothing

The account type never carried an economic guarantee. What settles a payment
is that the value arrived at the provider and cannot be taken back, and that
is asserted entirely by the checks that remain:

- `toType == 0` — the recipient is a plain account, so the value is credited
  rather than handed to contract logic.
- `flags == 0` — not a contract creation, not a signalling transaction.
- a non-empty `proof`, and `executionResult` true once included.
- inclusion inside the intent's lifetime, then **macro-block finality**.
  *Per ADR-021 the second half of this line is now the confirmation policy's:
  `inclusion` issues the Pass on the canonical inclusion and finalises
  afterwards, `finality` keeps the order written here. The inclusion
  requirement and the intent's lifetime are unchanged under both.*
- the provider's exact address, the exact Luna, the network.
- this intent's `NP1:` bytes, or no Nimpass reference at all — another
  purchase's reference is still refused outright.
- global hash uniqueness, so one transaction settles exactly one Pass.

An outgoing HTLC or vesting transfer that satisfies all of those credits the
recipient exactly as a basic transfer does. Finality is finality regardless of
which account type the value left.

**Ownership is unaffected.** ADR-013 already made `owner_wallet` the
authenticated buyer's `expected_wallet` rather than the on-chain sender, which
is what makes this safe: a contract address is recorded in
`verified_sender_wallet` as an audit fact and can never become a Pass owner.

### What is deliberately *not* relaxed

The sender gate for a payment carrying **no** reference. Without the reference
there is nothing purchase-specific on chain, so ADR-013's rule stands
unchanged — the sender must equal the wallet the intent was issued to, and a
contract address is then a stranger like any other. For a wallet of this shape
that means a scanned payment which drops the request link's `message` cannot
settle automatically; the manual hash form is what that case is for. Refusing
to guess is the right direction of error.

### Consequences

`docs/05-NIMIQ-PAY-INTEGRATION.md §43` ("verified transaction sender = pass
owner wallet") is now doubly superseded — by ADR-013 for the correlation rule
and by this for the account type. The two purchases above are not recovered by
this change: a `MISMATCH` candidate is never re-examined and `FAILED` is
terminal, so they stay failed and their payments stand as a compensation
matter.

Regression coverage lives in
`backend/internal/application/contract_sender_test.go`, which asserts both
halves: an HTLC payment carrying the reference settles, and every other
`EXECUTION` condition still refuses.

---

## ADR-015 — Deleting a Pass archives it; nothing a customer bought moves

**Date:** 2026-09-17
**Status:** Accepted
**Implements:** `08-ARCHITECTURE.md` §135 (soft delete) and §136 (pass
deactivation), which described this behaviour and had no endpoint behind it
**Affects:** `domain/catalog_pass.go` (`Pass.Archive`),
`application/catalog.go`, `database/catalog.go`,
`DELETE /catalog/passes/{passID}`, `backend/openapi.yaml`,
`frontend/web/src/components/catalog/delete-pass-action.tsx`

### Problem

A provider could create a Pass and publish it, and then had no way to stop
selling it. `Pass.status` already had `UNAVAILABLE` and `ARCHIVED`, and no
transition in the code or the contract reached either — so the only ways to
withdraw a Pass were to ask somebody with database access, or to leave it on
Discover.

### Why a delete could not be a delete

`purchased_passes`, `purchases`, `verified_payments`, `pass_sessions` and the
redemption trail all reference the catalog Pass, several through composite
foreign keys. Removing the row would either be refused by the database or take
a customer's paid-for pass with it, and §135 is explicit that completed passes,
redemption history and confirmed purchases stay auditable.

### Decision

`DELETE /catalog/passes/{passID}` sets `status = 'ARCHIVED'` and returns the
archived Pass rather than `204`, because the response is the honest statement of
what happened.

```text
new purchases        blocked   (Pass.CanPurchase requires ACTIVE)
public discovery     gone      (publicPassSQL requires ACTIVE)
provider catalogue   gone      (ListProviderPasses excludes ARCHIVED)
edit / publish       refused   (409; ARCHIVED is terminal in the domain)
purchased passes     unchanged — sessions, history, receipts, all of it
```

Authorisation is the statement, not a check in front of it: the ownership
predicate `pr.owner_identity_id = $2` is part of the same query that performs
the write, so another provider's id matches no row and receives `404` — not
`403`, because it is not theirs to know about (`09-SECURITY.md` §31, §33).

### Terminal in both directions

An archived Pass cannot be republished. A link a customer already holds would
otherwise change what it sells underneath them; a provider who wants to sell it
again creates it again, and gets a new Pass with its own id and its own terms.

### What the confirmation says, and why

Not "are you sure?". The dialog states the two consequences separately — new
purchases stop, existing passes continue — because the second is the thing a
provider is actually worried about and the archival model is what lets us
promise it.

---

## ADR-016 — The provider directory is a server answer, not a by-product of the catalogue

**Date:** 2026-09-17
**Status:** Accepted
**Affects:** `GET /public/providers`, the `provider` filter on
`GET /public/passes`, `database/catalog.go`, `backend/openapi.yaml`,
`frontend/web/src/pages/providers.tsx`, `/providers`

### Problem

"Explore providers" on Discover was assembled in the browser by de-duplicating
the providers of whatever `GET /public/passes` returned — a page capped at 100
passes, newest first. Three things followed, and all of them were wrong:

- a provider whose passes fell off that page stopped being discoverable at all,
  with no page anywhere that would list them;
- the pass count on each card was "how many of this provider's passes happened
  to be on this page", presented as a fact about the provider;
- there was no route to a full directory, because there was no full list.

A provider page had the same shape of bug: its "Available passes" grid was the
global catalogue filtered on `provider.id`, so a storefront could silently omit
passes.

### Decision

Two server-side answers, one rule.

`GET /public/providers` returns every provider with a verified payout wallet and
at least one pass the public catalogue would list, with `passCount` counted from
those same rows. `GET /public/passes?provider=<uuid>` narrows the catalogue to
one storefront.

Discoverability is defined exactly as Discover has always defined it, and the
SQL reuses `publicPassSQL`'s predicate rather than restating it, so the
directory and the catalogue cannot disagree about who is sellable. A provider
with nothing published is deliberately absent: their storefront could only say
"no passes available", and a directory of dead ends is worse than a shorter one.

`/providers` renders the whole list; Discover keeps a six-card preview and a
"See all providers" link. No pagination — the endpoint returns up to 200 in one
page, which is the whole directory at Nimpass's size, and a cursor for a list
the contract does not page would be a mechanism with nothing behind it
(`08-ARCHITECTURE.md` §145).

### Why not `/public/providers/{id}/passes`

It is ambiguous with the existing `/public/providers/by-slug/{slug}` — both are
`/public/providers/X/Y` — and an OpenAPI description that cannot be resolved
unambiguously is a contract defect even where one router happens to order its
routes correctly. A query parameter on the endpoint that already serves passes
says the same thing with no ambiguity.

---

## ADR-017 — A readable provider slug, disambiguated by counting

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** the slug rules already in `000008_product_completion` and
`domain/profile.go`, which are otherwise unchanged
**Affects:** `domain.SlugCandidates`, `application/catalog.go`

### Problem

A provider created inside the product — through the "Set up your workspace"
form, which asks only for a display name — received
`GeneratedSlug(name, id)`: the name plus their whole UUID.

```text
/providers/emin-kutlu-0f3ac1d24b7e4f0a91c5d8e2b6704a13
```

Correct, unique, immutable, and not a link anybody would send to a customer.
The readable slugs in the product all came from the seed, which sets them by
hand.

### Decision

`SlugCandidates(name, id)` offers the readable slug first and the guaranteed one
last:

```text
emin-kutlu, emin-kutlu-2 … emin-kutlu-9, emin-kutlu-<id without hyphens>
```

`Catalog.CreateProvider` walks that list and keeps the first the database
accepts. Uniqueness therefore stays where it was — the `providers_slug_unique`
constraint decides, and a `23505` is what advances the walk — so two providers
registering the same name at the same instant cannot both take one slug. The
last candidate carries the provider's own id and cannot collide with anything,
which is what makes the walk terminate.

A name that cannot produce a valid slug on its own — two characters,
punctuation, a script with no ASCII in it — skips straight to the id form
rather than being padded into something the provider never wrote. In
particular it does not become the literal word `provider`, so the first such
account cannot take `/providers/provider`.

### What did not change

Everything that makes a slug safe. A slug supplied explicitly by the client is
still normalised, still validated against the reserved list and the UUID shape,
and a duplicate is still `CONFLICT` — never silently renamed to something the
provider did not ask for. Slugs remain immutable after creation, enforced by the
`providers_stable_slug` trigger as well as by the domain, so a rename never
breaks a shared link. Existing providers keep the slugs migration `000008`
backfilled; nothing is re-slugged.

---

## ADR-018 — The mobile checkout is an overlay, and one vocabulary describes the payment

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-009 and ADR-010's checkout branching, which are unchanged —
this is about where the chosen surface is drawn
**Affects:** `components/payment/mobile-checkout-sheet.tsx`,
`mobile-checkout.tsx` (was `native-checkout.tsx`), `checkout-status.ts` (was
`qr-checkout-status.ts`), `purchase-checkout.tsx`, `purchase-panel.tsx`

### Problem

Tapping Buy on a phone rendered the review into the purchase panel — which on
a phone sits at the bottom of a long pass page, below the artwork, the
description and the facts table. Nothing visibly happened at the point of the
tap, and the step the customer had just asked for was somewhere they had to go
and find. On a page that also carries a sticky Buy bar, the obvious reading of
"nothing happened" is to tap Buy again.

### Decision

The mobile branch opens as a modal sheet, on the tap, before the intent exists —
so there is no interval in which the screen is unchanged. It stays until the
payment reaches an outcome.

It is not a second checkout. `NativeCheckout` and `MobileHandoff` are the same
components, embedded rather than duplicated; the wallet call, the dispatch lock,
the submission and the polling all stay in `usePurchaseFlow`. `/purchases/{id}`
still renders them inline, because there the checkout *is* the page and a dialog
over a one-item page is ceremony.

### The rule that came out of building it

**A surface that covers the page owns everything the page would have said.**

An error line, a "Check again", a "Paid, but still waiting?" offer or a status
line rendered underneath an open modal is a message nobody can read and a
control nobody can press — and rendering it in both places puts two of each in
the document. So the sheet's visibility is owned by the panel
(`useMobileCheckoutSheet`), and the panel yields its error line, its
`PaymentStateView` and its recovery offer exactly while it is covered.

`PaymentStateView` is rendered *inside* the sheet rather than re-worded for it.
One vocabulary describes the purchase lifecycle and one set of actions is
attached to it; a sheet-shaped second copy would have been two wordings for one
backend fact, with the richer one stranded underneath.

### Which states the sheet does not report

Success has its own dialog, and the outcomes that need a paragraph — uncertain,
refused, compensation — belong on the page where they can be read at leisure and
where the panel already scrolls them into view. The sheet closes for all of
them rather than stacking a modal over the explanation.

### Consequence: "Working…" is gone

`flow.busy` spans creating the intent, an open approval sheet, a submitted
transaction, chain verification, macro-block finality and pass issuance. One
word covered all six. Every surface now words the payment through
`checkoutStatus`, a projection of the backend's own `Purchase.status` shared by
the QR modal, the sheet and the Buy button. The single exception is
`AWAITING_WALLET`, which is a fact about this browser rather than about the
purchase, and is named as such.

---

## ADR-019 — A healthy candidate is re-checked at the worker's tempo, not on a fixed floor

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-013, which established "backoff counts failures, not quiet" for
*discovery* and left the same defect in place for *verification*
**Affects:** `database/payment.go` (`Due`),
`frontend/web/src/hooks/use-purchase-flow.ts` (`POLL_INTERVAL_MAX_MS`)

### Problem — measured from the query, not guessed

ADR-013 set the reconciler to run every two seconds while any intent is live,
and it does. But `Due()` — the query that decides which candidate transactions
that sweep may look at — would not return a candidate whose last check was less
than thirty seconds old:

```sql
c.last_checked_at < now - (interval '30 seconds' * power(2, LEAST(c.retry_count, 4)))
```

`Mark()` resets `retry_count` to 0 for `SUBMITTED` and `AWAITING_FINALITY`, so
a *perfectly healthy* payment still sat out a flat thirty-second floor between
every step of its own verification — and a purchase passes through two or three
of those steps (submitted → included → finalised) before a Pass exists. A
transaction final on chain within seconds therefore took a minute or more to
surface, while a worker ticking every two seconds looked at it and declined to
act.

The frontend compounded it. The poll ceiling was fifteen seconds, chosen when
the server floor was thirty, so a confirmation could be up to another fifteen
seconds from reaching the screen. The spinner in between was the whole of what
the customer saw, and it is what "Working… for a long time" was.

### Decision

The floor becomes the same rule discovery already follows:

```text
retry_count = 0   healthy — submitted, included, or waiting on the macro block.
                  Re-read at 2 s, the worker's own active tempo.
retry_count > 0   consecutive UNCERTAIN / NOT_FOUND, which only an RPC that
                  could not answer produces. Backs off 30 s, 60 s … 8 min,
                  exactly as before.
```

The frontend ceiling drops to six seconds to match. *ADR-021 moved it again —
first poll 1.5 s, ceiling 4 s — once settlement stopped waiting out a macro
block and the answer became a poll or two away rather than twenty.*

### Why this weakens nothing

Not one verification input changed. The same `Inspect` → `validateEvidence` →
finality → `Confirm` path runs, and asking the node sooner cannot make an
unfinalised transaction final — it only stops the server declining to ask. *The
`finality` step is a configured policy as of ADR-021; this ADR's argument is
unaffected, because it was about when the server is willing to look, not about
what it requires when it does.* The
cost is bounded by the intent's own lifetime and by the reconciler's `busy()`
tempo, which was already 2 s whenever any intent is live; the states this
affects exist only while a purchase is actively settling.

Backoff still exists where it was actually earning its place: an endpoint that
is unreachable or throttled does not become reachable by being asked more often,
and that case is untouched.

Regression coverage is
`backend/internal/database/reconcile_tempo_test.go`, which asserts both halves —
a healthy candidate is due again after three seconds, a failing one is not.

---

## ADR-020 — The provider record is created by the first Pass, not before it

**Date:** 2026-09-17
**Status:** Accepted by the user's explicit instruction ("workspace kısmını
kaldıracaksın, direkt form gözükür olacak").
**Completes:** ADR-008, which removed the workspace but left one setup screen
standing in front of it
**Refines:** `02-USER-FLOWS.md §128`, whose first two steps are now performed by
the one form; ADR-017's slug walk is unchanged and is what names the record
**Affects:** `frontend/web/src/components/provider/workspace-gate.tsx` (removed,
replaced by `account-boundary.tsx`), `pages/provider/pass-form.tsx`,
`pages/provider/pass-validation.ts`, `pages/my-store.tsx`,
`hooks/use-provider-workspace.ts`

### Problem

ADR-008 removed the workspace shell and folded the service and the payout wallet
into the Pass form. One screen survived it: a wallet that owned no provider
record was shown "Set up your workspace" — a display name, a headline and a
Create workspace button — before it was allowed to see the Pass form or My
Store.

It was reported as a *device* bug, and the shape of the report is the point.
Signed in through the Nimiq Pay WebView the phone showed a setup form; the same
build on a laptop showed the Pass form. Nothing in the code branches on device
class there — `checkout-device.ts` routes payments and nothing else (ADR-009) —
and the two screens differed because the two runtimes sign in with *different
wallets*: the Nimiq Pay wallet had no provider record and the Hub wallet did. A
setup step that only some wallets ever meet is indistinguishable, from inside
the product, from a screen that is missing on one platform.

Underneath the copy it was also the exact dead end ADR-008 exists to remove:
"go and create a thing before you can create the thing you came for".

### Decision

There is no step in front of the form. Creating a Pass creates whatever that
Pass needs:

```text
Create Pass -> form -> [provider] -> [service] -> pass -> Preview/Edit -> Publish
                        ^ created only if this wallet has none
```

`useEnsureProvider` is the same move `useEnsureService` makes one level down,
and it resolves to the existing record — with no request — for every wallet that
already has one. Each id is threaded from the call that produced it into the
next write rather than re-read from the query cache, because on a first sale the
provider is created microseconds earlier and the profile query has not returned:
reading it back is how a write reaches `/providers/undefined/services`.

`WorkspaceGate` becomes `ProviderAccountBoundary`. It no longer decides whether
the area may render — sign-in is already `RequireSession`'s question and
authorisation is the backend's (`09-SECURITY.md §33, §67`) — it only waits for
the profile query to answer and surfaces its failure. A provider-scoped list
whose identity owns nothing now resolves to an empty list instead of staying
disabled, because a disabled react-query query reports `isPending` forever and
renders as a skeleton that never resolves.

### Why the name is still asked for

One field remains, on the form, on a first sale only: **Your store name**. It
is not derived from the wallet address, and that is deliberate.

`ProviderInput.name` is required, the column rejects blank
(`providers_name_nonempty`), and the name is what generates the public page
address (ADR-017) and what every customer reads under every Pass this wallet
ever sells. ADR-008's known gap is that `Provider.name` has no editing surface
any more — so a name nobody chose would be a permanent one. Inventing
`NQ25 HFL4 8SG8` as a storefront to avoid one text field is not a simplification.

The headline the old card collected is gone. `Provider.headline` keeps its empty
default; nothing displays a blank one.

### What this does not change

The domain relation is intact: a pass still belongs to a service, which still
belongs to a provider, and every one of those writes is still authorised
server-side from the session. Payout verification still gates publishing
(`catalog.go`), still at the moment Publish is pressed. Nothing here makes a
wallet a provider — the backend does, from the record it created for that
identity.


---

## ADR-021 — A Pass is issued on canonical inclusion; finality is tracked, not waited for

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-019, which removed the software floors in front of settlement
and left only the chain's own wait — which turned out to be all of it
**Supersedes, for the issuance moment only:** the "inclusion inside the intent's
lifetime, then macro-block finality" rule stated in ADR-014 and ADR-011. Those
records describe what the verifier checks, and every one of those checks still
runs. What changes is which of them the customer is made to stand still for.
**Affects:** `domain/settlement.go` (new), `domain/purchase.go`,
`database/settlement.go` (new), `migrations/000017_provisional_settlement.up.sql`,
`application/payment.go`, `config/config.go`, `openapi.yaml`

### Problem — measured on Mainnet, 2026-09-17

ADR-019 fixed the two waits Nimpass had invented for itself: a thirty-second
re-check floor on a healthy candidate and a fifteen-second poll ceiling on the
screen watching it. With both gone, the remaining wait was the chain's, and it
is the larger one.

Nimiq Albatross produces a micro block roughly every second and a macro block
at fixed multiples of the batch length. Measured against
`https://rpc.nimiqwatch.com`: head `61854673`, and `getMacroBlockAfter` for it
returns `61854720` — forty-seven blocks, so roughly forty-seven seconds, for a
payment that was already in a block. Where in the batch the transaction lands
is arbitrary, so the wait is uniform over roughly nought to sixty seconds.

That was the whole of "Nimiq Pay ile ödeme çok uzun sürüyor". The transaction
was on chain in about a second; the Pass appeared up to a minute later, and the
customer watched a spinner for the difference with nothing wrong.

### Decision

The deployment chooses, through `NIMIQ_CONFIRMATION_POLICY`:

```text
inclusion  (default)  the Pass is issued once the payment is canonically
                      included and has passed the entire verifier. Finality is
                      then tracked in the background.
finality              the Pass is withheld until the macro block. The original
                      behaviour, kept so a deployment can choose it without a
                      fork.
```

An unparseable value fails startup, and `VerifiedPayment.Satisfies` refuses
everything for a policy it does not recognise, so a mistake here settles
nothing rather than settling everything.

A receipt therefore has a state of its own, separate from the purchase's:

```text
INCLUDED    accepted, canonically included, macro block still pending
FINALIZED   the macro block was observed and still contains it
CONTESTED   the chain stopped showing it and the deadline passed
```

`verified_payments` holds all three. Accepting an inclusion also stores
`expected_finality_block` — the macro height this receipt is waiting for, which
is policy arithmetic rather than chain state and so is known the moment the
transaction is in a block. A receipt that cannot name that height is refused
under the inclusion policy, because a provisional payment nobody could ever
promote or contest is worse than a slow one.

### Why this weakens no verification

Not one economic check moved. Before a receipt exists at all, under either
policy, the payment must still satisfy: the proven network, the intent's
snapshotted recipient, the exact price to the Luna, this intent's own `NP1`
reference or — absent any data — the buyer's own sending wallet, `toType == 0`,
`flags == 0`, a non-empty proof, `executionResult` true, canonical inclusion in
a block the node re-reads and agrees with, submission and inclusion inside the
intent's lifetime, and global hash uniqueness through the `verified_payments`
primary key. A mempool transaction still settles nothing. Cross-network
settlement is still refused outright.

What the policy governs is the *wait*, never the *validation*.

### What it does trade, stated plainly

Between inclusion and the macro block — under a minute — the Pass exists on
evidence that is canonical but not yet irreversible. Three consequences follow,
and none of them is hidden:

- **The Pass is redeemable in that window.** Nothing gates redemption on
  `settlement.provisional`. A session consumed against a payment that is later
  reversed is service given for money that never became canonical.
- **A reversal withdraws the Pass.** The finality worker refuses to do this
  until the chain is demonstrably past `expected_finality_block` *and* the node
  has failed to produce the transaction `settlementContestThreshold` times.
  Absence before that height proves nothing and is recorded as an uncertain
  check, not as a verdict.
- **A withdrawal opens a compensation case**, reason
  `PAYMENT_SETTLEMENT_REVERSED`, resolution `PASS_WITHDRAWN`, and — unlike every
  other compensation case — `doNotPayAgain: false`, because no NIM ever left the
  customer's wallet. The receipt is not deleted; it is the record of what was
  accepted and on what basis.

A reorg that undoes a canonically included Albatross micro block is rare, not
impossible, and the honest reason to accept the risk is its size against a
session-pass price, not a claim that it cannot happen. A deployment that does
not want the trade sets `NIMIQ_CONFIRMATION_POLICY=finality` and waits.

### What the worker may not do

Promotion re-reads the chain and compares it against the stored receipt, and it
is allowed to conclude exactly three things. The same transaction in the same
block, finalised: promote. The same transaction canonically included somewhere
else: re-anchor to the new height and keep tracking — the money arrived, only
the block changed, and the customer is not punished for how long re-inclusion
took. Gone, past the deadline, repeatedly: contest.

Everything else — a timeout, a 429, a resyncing node, a malformed reply, a node
describing a different transaction under the same hash — is uncertainty, and
uncertainty retries. The receipt stays `INCLUDED` and the purchase stays
confirmed, because "we do not know" and "the payment is gone" are different
facts and only one of them is about the payment.

---

## ADR-022 — The RPC budget is read from the gateway, not discovered by being refused

**Date:** 2026-09-17
**Status:** Accepted
**Refines:** ADR-019, whose two-second tempo is only affordable if a tick costs
a bounded number of requests
**Affects:** `nimiq/rpc.go`, `application/payment.go`

### Problem — measured against the endpoint the product targets

`https://rpc.nimiqwatch.com` is a shared public gateway, and its limiter is
harder than the per-token accounting previously assumed. Measured 2026-09-17:

- **Twenty requests per fixed ten-second window, with no refill inside it.**
  Six calls in one second take the remaining count from 19 to 14; six seconds
  later it is still 13. The window resets as a block.
- **It publishes its own state.** Every response carries
  `X-RateLimit-Remaining` and `X-RateLimit-Reset`, the latter being the unix
  second the next window opens.
- **It serves no JSON-RPC batches.** An array request is answered `400 Invalid
  JSON-RPC request`, so N questions cost N requests.
- It still refuses `getNetworkId` while serving everything else, as recorded
  previously.

Against that, the reconciler's own cost was unbounded in the wrong places. A
single verification spent up to eight requests — consensus, the transaction,
its block in full, the macro height, the head, the macro block, and the
inclusion block re-read — and it spent all eight again on every tick while
waiting for finality. At a two-second tempo that is one purchase consuming
roughly thirty requests per ten-second window on its own, against a ceiling of
twenty, before discovery had asked anything.

The consequence was not a slower sweep. It was a **slower payment**, through a
coupling that is easy to miss: a 429 came back as `ErrRPCRateLimited`,
`Reconcile` recorded anything that was not an outright not-found as
`UNCERTAIN`, and `UNCERTAIN` is the one status that increments `retry_count` —
which under ADR-019 pushes the next look out 30 s, 60 s, … 8 min. Nimpass
throttling itself was therefore paid for in half-minute steps of customer-facing
spinner, on a payment that was already on chain. The system got slower the
harder it tried.

### Decision

**Read the published budget and respect it locally.** The adapter tracks
`X-RateLimit-Remaining` and `X-RateLimit-Reset` from every response. When the
window it was told about is spent, a call returns `ErrRPCRateLimited` without
being sent. Within one window the lower figure wins, because concurrent
responses arrive out of order and believing a stale higher remaining is how a
limiter gets walked into; the reservation is optimistic for the same reason,
since four concurrent verifications reading "1 remaining" must not all conclude
they may send. A 429 that arrives anyway closes the window.

Refusing locally is strictly better than being refused remotely: the answer is
identical, it costs no round trip, and it cannot deepen whatever penalty a
gateway applies to a client that keeps knocking.

**Ask shared questions once per sweep.** The chain head is cached for one
second — a micro block's own lifetime — and an established consensus for two,
one reconciler tick. Both were previously asked by every leg of every purchase
in the sweep. `getMacroBlockAfter` is memoized outright, because it is policy
arithmetic rather than chain state: macro blocks sit at fixed multiples of the
batch length, so for one height on one network the answer is a constant, and a
settlement waiting on finality used to ask for it on every poll.

**Do not re-verify to be told "not yet".** A provisional receipt stores the
macro height it is waiting for (ADR-021), so the finality worker's ordinary
answer costs one cached head read for the whole sweep rather than a full
pipeline per receipt.

**A throttle is not a failure, anywhere.** This is the half that fixes the
coupling above, and it applies to all three workers:

- *Verification* writes nothing at all — not even the check time. Recording
  `UNCERTAIN` was what set the 30 s … 8 min backoff on a purchase we had simply
  not looked at. The candidate stays immediately due, and the retry is free.
- *Discovery* does not count a failure against the address. An unreachable node
  earns its backoff, because asking it sooner will not make it answer; a 429
  clears on the gateway's own schedule, and backing an address off by up to
  five minutes for it is five minutes of a paid QR purchase looking unpaid.
- *Promotion* records nothing, and here it is a safety property rather than a
  tempo one. `settlement_attempts` is what `contest` counts toward taking a
  Pass away, so letting our own throttling inflate it would let a later genuine
  absence withdraw a Pass after fewer real absences than the threshold names.

The rule is the codebase's existing one — backoff counts failures, not quiet
(ADR-013, ADR-019) — extended to the case where the silence is ours.

### Why the caches are safe

Each one is one-directional in the direction that cannot invent a settlement:

- A head up to a second stale is a *smaller* number, and the comparison is
  `head.Number < macroHeight`. It can delay a confirmation by under a second;
  it can never make an unfinalised transaction look finalised. It is also never
  moved backwards, so a slow concurrent read cannot un-advance the chain for
  everyone else.
- Consensus is cached only when it is established, for one tick, and a node
  that has lost it is re-asked on the very next leg. It is a genuine safety
  check on a short leash rather than an assumption; everything the evidence
  actually rests on — the transaction, its block, the macro block, the head —
  is re-read inside that window anyway.
- The macro height is memoized per inclusion height on a client whose network
  is proven separately, and a wrong one could only ever delay a promotion,
  never grant one: `Inspect` still re-reads the macro block and the inclusion
  block before calling anything final.

A node that publishes no rate-limit headers — a local `core-rs-albatross`, for
instance — is unaffected in every respect. The budget simply stays unknown and
every call goes out exactly as before.

---

## ADR-023 — Removing a Pass from the listing is a separate, reversible act from deleting it

**Date:** 2026-09-17
**Status:** Accepted
**Complements:** ADR-015, which made "delete" an archival write and left it terminal
**Implements:** `08-ARCHITECTURE.md` §34 (`UNAVAILABLE` affects new purchases and
must not invalidate existing purchased passes), `02-USER-FLOWS.md` §80 (provider
Pass management distinguishes ACTIVE from UNAVAILABLE), `03-DESIGN-SYSTEM.md`
("active, unpublished or otherwise unavailable")
**Affects:** `domain/catalog_pass.go` (`Pass.Unpublish`),
`application/catalog.go`, `database/catalog.go`, `database/payment.go`,
`POST /catalog/passes/{passID}/unpublish`, `backend/openapi.yaml`,
`frontend/web/src/components/catalog/{unpublish-pass-action,pass-actions-menu}.tsx`

### Problem

A provider who wanted to stop selling a Pass had exactly one control: Delete.
ADR-015 made that deliberately terminal — an archived Pass cannot be edited or
republished, and it leaves the provider's own catalogue — which is correct for
"this product is finished" and wrong for "not this month". The only way to pause
selling was to destroy the product and rebuild it later as a different Pass,
with a different id and a different link.

The model for the milder act already existed and had no way in. `Pass.status`
carried `UNAVAILABLE`, `passes_status_valid` accepted it, `Pass.Publish` already
accepted it as a *source* state, and the frontend already had a label for it —
but nothing in the code or the contract ever set it. The gap was a missing
transition, not a missing concept.

### Decision

`POST /catalog/passes/{passID}/unpublish` sets `status = 'UNAVAILABLE'` and
returns the Pass. It is a second route rather than a flag on the delete, because
the two are different acts with different consequences:

```text
                      unpublish            delete (archive)
new purchases         blocked              blocked
public discovery      gone                 gone
public pass page      gone                 gone
provider directory    count drops          count drops
provider catalogue    KEPT, labelled       gone
edit                  allowed              refused (409)
publish again         allowed              refused (409) — terminal
purchased passes      unchanged            unchanged
```

The lifecycle is therefore `Published → Unpublished → Published` on one row:
same id, same URL, same purchase history, nothing re-created.

`Pass.Unpublish` accepts only ACTIVE. A DRAFT was never listed and an ARCHIVED
Pass is finished; moving either into UNAVAILABLE would overwrite a distinct fact
with a weaker one, and would give an archived Pass a way back onto the shelf
through the wrong door.

### Idempotency, asymmetrically

Unpublishing something already unpublished returns 200 with the row untouched.
Archiving twice stays a 409. The asymmetry is deliberate: a repeat archive means
the caller believes there is still something to end, while a repeat withdrawal
is a request for a state that already holds.

Publishing something already published was **not** changed. It remains a 409
(`mission02_test.go`), because that contract predates this feature and nothing
here required loosening it.

### Purchase refusal is named, not generic

`PaymentRepository.Create` already refused a non-ACTIVE Pass, but only through
`domain.NewPurchase` and only as an unnamed conflict, which surfaced to the
customer as a payment-state error for a payment that had never started. The
check is now explicit and carries `application.ErrPassUnavailable`, answered as
`409 PASS_UNAVAILABLE` — a code `08-ARCHITECTURE.md` §66 already defined and the
frontend already had copy for.

It wraps `ErrConflict` rather than replacing it, so every existing
`errors.Is(err, ErrConflict)` caller and every 409 assertion still holds. The
case it exists for is the stale tab: the Pass was on Discover when the page
rendered, the provider withdrew it, and Buy is pressed against a screen that is
no longer true. The pass row is read under the same `FOR SHARE` lock as the
price and the payout wallet, so the refusal is decided against the database, not
against what the client had on screen (`09-SECURITY.md` §11, §37).

### No migration

`passes_status_valid` has accepted `UNAVAILABLE` since `000001_core`. Adding one
would have been a no-op against the live schema.

### Interface

The two actions share a card's `•••` menu, built on the existing centred sheet
rather than an anchored dropdown — `popup-surface.test.tsx` requires one popup
surface, and a centred panel is sized from the viewport, so it cannot be clipped
at a screen edge on a phone. Withdrawal confirms with a `primary` button and
delete keeps its red one, so the two decisions cannot be mistaken for each other
at the moment of pressing. Delete's dialog now names the alternative, for
someone who is in the wrong one.

---

## ADR-024 — A withdrawn Pass is withdrawn by its status; its session counters keep telling the truth

**Date:** 2026-09-17
**Status:** Accepted by the user's explicit instruction ("settlement/reversal
akışındaki tüm open sessions, completed sessions, redeemable session
bağımlılıklarını bul ve güncel Pass-only ürün modeline göre kaldır/düzelt")
**Refines:** ADR-021, which introduced the reversal but let it rewrite session
accounting on the way out
**Preserves:** ADR-007 and ADR-012 — a pass is still a list of sessions, still
spent by its owner. Nothing here removes sessions from the product.
**Affects:** `database/settlement.go` (`ReverseSettlement`),
`frontend/web/src/components/pass/session-progress.tsx`

### Problem — measured, not read off the SQL

The withdrawal wrote:

```sql
UPDATE purchased_passes
   SET status='CANCELLED', remaining_sessions=0, used_sessions=original_sessions
 WHERE purchase_id=$1 AND status='ACTIVE'
```

The second and third assignments are a lie, and they are a lie in the
customer's disfavour. Run against a real database, a withdrawn ten-session Pass
whose owner had attended **nothing** reported `used_sessions=10` against
`COMPLETED` session rows `= 0`. With two sessions genuinely delivered it
reported ten used and two completed.

That directly breaks the invariant `000015_pass_sessions.up.sql` states in
prose: *every COMPLETED row corresponds to exactly one increment of
`used_sessions`, written in the same transaction.* It also contradicts the
withdrawal's own doc comment three lines above it, which promises that
completed sessions are left alone because "a provider who delivered one is a
fact the recovery case needs".

The inflation was not malice, it was arithmetic. `passes_balance_consistent`
requires `used + remaining = original`, so zeroing `remaining` obliges you to
inflate `used`. The counter was then the number a human settled the
compensation case from — the one place the difference between "delivered" and
"never received" decides who is owed what.

### Decision

The reversal writes the status and nothing else:

```sql
UPDATE purchased_passes SET status='CANCELLED'
 WHERE purchase_id=$1 AND status='ACTIVE'
```

Open session rows are still cancelled, so the pass's own session list reads
honestly: these were sold, never delivered, and never will be. COMPLETED rows
and both counters are untouched.

No migration is needed. `used + remaining = original` still holds because
neither side moved, and `passes_active_balance` only ever constrained an ACTIVE
pass.

### Why nothing becomes spendable

The counters were belt-and-braces over a guard that never depended on them.
Redemption is refused on the pass's **status**, at three independent layers:

- `application.Redemptions` — `if pass.Status != domain.PurchasedPassActive`
- `database` — the same test again inside the consuming transaction
- `domain.PurchasedPass.ConsumeSession` — requires ACTIVE, and
  `spendPassSession`'s own `WHERE … AND status='ACTIVE'` would refuse the write
  even if both checks above were wrong

A CANCELLED pass carrying `remaining_sessions = 8` is refused by every one of
them. `TestWithdrawalKeepsTheRecordOfSessionsAlreadyDelivered` asserts both
halves — the counters survive, and the pass is not consumable.

### A Pass that is no longer ACTIVE is not touched

If every session was delivered (COMPLETED) or the pass ran out of time
(EXPIRED), there is nothing left to withdraw. Rewriting that history to
CANCELLED would erase the record of service a provider actually gave, which is
the evidence the compensation case is settled from. The case still opens; a
human closes it knowing what was delivered. This was the existing behaviour of
the `status='ACTIVE'` filter; it is now a decision rather than an accident.

### The same rule on the screen

`SessionBalance` decided "is this finished?" from `remainingSessions === 0`
alone, so a truthful counter made a withdrawn Pass advertise "8 sessions
remaining" beside its own Withdrawn badge. It now asks the same question
`pass-surface.tsx` already asks — `status !== 'ACTIVE'` — and renders the
past-tense form, "2 of 10 sessions used".

This also fixes a case that predates the withdrawal entirely: an **expired**
Pass with sessions left on it had always advertised them as remaining.

---

## ADR-025 — The wallet that signs in is the wallet that gets paid

**Date:** September 2026
**Status:** Accepted
**Supersedes:** ADR-008 §2 (payout verification offered inline at Publish)
**Amends:** `09-SECURITY.md` §21 for the *initial* payout wallet; §22 and §23
(changing one) are unchanged
**Affects:** `backend/migrations/000018_owner_payout_wallet.up.sql`,
`backend/internal/domain/provider.go`, `backend/internal/application/catalog.go`,
`backend/internal/database/catalog.go`,
`frontend/web/src/components/provider/payout-panel.tsx` (removed),
`frontend/web/src/hooks/use-provider-workspace.ts`,
`frontend/web/src/pages/provider/pass-form.tsx`

### Problem

A provider was created with no payout wallet and could not publish anything
until they finished a `VERIFY_PROVIDER_WALLET` ceremony: type a Nimiq address,
sign from it, then sign again from the login wallet. ADR-008 moved that
ceremony inline so it appeared when Publish was pressed, which fixed *where* it
was without changing *what* it asked.

What it asked was the problem. On a phone the provider is handed an address
field between deciding to sell and selling — and the address they are being
asked to type is, in every real case, the wallet they signed in with a minute
earlier. The product knew it and asked anyway, and each signature is a wallet
round trip that can fail, be dismissed, or be blocked by the one-popup-per-click
rule (ADR-001).

### Decision

The payout wallet is adopted from the session when the provider record is
created, and no ceremony stands in front of the first one.

```text
sign in (AUTH_LOGIN, signed challenge)
        ↓
identities.wallet_address  ← proven
        ↓
POST /providers            ← payout_wallet := session identity's wallet
        ↓
Create Pass → Publish      ← one press
```

`Catalog.CreateProvider` calls `Provider.AdoptOwnerPayout(actor.Wallet, now)`.
The address is read from the authenticated session; `ProviderInput` has no
payout field and never did, so no request body can name one.

### Why this is not a weakening

§21 exists to stop payments being routed to a wallet nobody proved control of.
The login proof is exactly that proof: a session exists only because a fresh,
backend-authored `AUTH_LOGIN` challenge was signed by that wallet, and
`identities.wallet_address` is the address that signature resolved to. Adopting
it introduces no unproven address.

The client's position is strictly worse than before, which is the point. Under
the old flow the address was **client-supplied** and a signature had to make up
the difference; a caller could name any address and then prove control of it.
Now a caller cannot name an address at all — a stolen session cannot point
payments anywhere other than the wallet it was stolen from.

Every property that depended on a second party is untouched:

- **Changing** the payout wallet still requires the full ceremony —
  `POST /providers/{id}/payout-challenges` and `/payout-verifications`, the
  payout wallet's signature and the login wallet's step-up (§22, §23). A
  different wallet is a wallet the login proof says nothing about.
- **Publishing** still refuses without a verified payout wallet. The 409 in
  `database/catalog.go` is unchanged; a provider simply no longer starts out in
  the state that triggers it.
- **The audit trail** still records every payout assignment. An adoption has no
  challenge to point at, so `provider_payout_audit.challenge_id` became
  nullable: NULL means "came from the session's login proof", non-NULL means a
  signed ceremony. The UNIQUE stays, and PostgreSQL does not treat NULLs as
  duplicates, so a challenge is still spendable once.

### Migration

`000018` backfills providers that have no payout wallet from their owner
identity's wallet, writing the matching audit rows first. Providers who *did*
verify one are untouched — including anyone who deliberately chose an address
other than their login wallet. The filter is "has none", never "differs from
the owner".

### Accepted consequence

`PayoutPanel` and `useVerifyPayoutWallet` are removed, and with them the only
surface in the product that reached the change endpoints. A provider who wants
to be paid into a wallet other than the one they sign in with has no way to say
so from the UI; the API can still do it, and ADR-008's known gap (no editing
surface for provider fields) now covers this too.

That is the trade this ADR makes deliberately: the common case — one wallet,
used for everything — costs nothing, and the rare case costs a screen that does
not exist yet. If it is built, it belongs behind the existing ceremony, not in
front of Publish.

---

## ADR-026 — One live pass per Pass, and a payment may not return to its sender

**Date:** 2026-09-18
**Status:** Accepted
**Refines:** ADR-012 (a provider cannot buy their own — extended from the
account to the wallet), ADR-013 (the sender stays out of correlation; this adds
no sender gate), `01-PRODUCT.md §56` and `02-USER-FLOWS.md §70` (Buy Again is
unchanged), `02-USER-FLOWS.md §38` (idempotency is unchanged)
**Affects:** `domain/purchase.go`, `database/payment.go`,
`application/auth.go`, `application/payment.go`,
`httpapi/payment_handlers.go`, `POST /purchases`, `types/payment.ts`,
`use-purchase-flow.ts`, `payment-state-view.tsx`, `purchase-panel.tsx`,
`use-passes.ts`

### Problem

Two purchases that should never have been possible, both reported from a real
session.

1. **The same Pass, bought twice, while the first one was still live.**
   Nothing refused it. `POST /purchases` reuses an unpaid intent and it
   honours an idempotency key, so a double tap has always produced one
   purchase — but once the first purchase *confirmed*, a second intent for the
   same Pass was created and paid like any other. The customer ends up with two
   pass records for one entitlement. The sessions do not merge, the pass screen
   shows one of them, and the second is money spent on a record they did not
   mean to create.

2. **A purchase that paid the buyer.** ADR-012 refuses a provider buying from
   their own catalogue and decides it against `providers.owner_identity_id` —
   the *account*. The payee is a different value: ADR-025 adopts the owner's
   login wallet as the payout wallet, but the `VERIFY_PROVIDER_WALLET` ceremony
   still exists and a payout wallet may be any proven address. Where that
   address is the buyer's own, the account check passes, the payment is a
   transfer to itself, and a Pass issues against a transaction that moved
   nothing but a fee.

### Decision

**A customer may hold one live pass per Pass.** A new intent is refused with
`409 PASS_ALREADY_OWNED` when that customer has a purchased pass for it that is
ACTIVE, has sessions remaining, and has not passed its expiration. The three
conditions are the definition of "still holding it" rather than a status test,
because expiry is applied lazily — an expired pass keeps its ACTIVE row until
something reads it.

The refusal is the last one `PaymentRepository.Create` applies, after
withdrawal, self-purchase and the cutoff, so a customer whose real problem is
that the Pass is gone is told that instead. It sits after both reuse branches,
so recovering an unpaid intent and replaying an idempotency key still answer
200 and `38. Duplicate Purchase Protection` is untouched.

**Buy Again is untouched.** Completed, expired and cancelled passes refuse
nothing. The loop `01-PRODUCT.md §56` describes — Purchase → Consume →
Complete → Repurchase — is exactly what stays legal; what stops is holding two
of the same entitlement at once.

**A purchase whose payee is the buying wallet is refused**, with the same
`403 SELF_PURCHASE_NOT_ALLOWED` ADR-012 answers, decided in the same place
against the payout wallet read under the same lock as the price, and compared
with the address the session proved rather than anything a client sent. It is
restated as an invariant in `NewPurchase`, which is where ADR-012 put the
account version of the same rule.

**And a transaction to itself settles nothing.** The intent-time check can only
know the wallet the session proved; Nimiq Pay pays from whichever account the
customer approves, so the paying address is the one thing the intent could not
have seen. `validateEvidence` therefore refuses evidence whose sender is its own
recipient, with the category `SELF_TRANSFER`.

### Why this is not the sender gate ADR-013 removed

ADR-013 removed *correlation by sender*: the rule that a payment had to come
from the wallet the intent was issued to, which is what left correctly-paid
purchases unmatchable. This asks nothing about which account paid and never
compares the sender to the intent. It asks whether any value moved, and where
the payee is the payer the answer is no. Reference-first discovery, contract
senders and multi-account wallets all behave exactly as they did.

### Consequences

`PASS_ALREADY_OWNED` is a new error code on `POST /purchases`. It wraps
`ErrConflict`, so every caller that only asked whether the request conflicted
keeps its answer and the status stays 409.

The browser hides the Buy button for a Pass the customer is holding, reading
the first page of their ACTIVE passes — presentation, like ADR-012's hidden
button, and deliberately not a full walk of their list. A customer with more
active passes than one page still sees the button and is answered by the
backend, which is where the rule lives.

Four existing tests bought the same Pass twice as *setup* for something else —
pagination, hash replay, republication. They are not evidence of a decision to
allow it; each has been reworked to buy a sibling Pass or to spend the first
one first, which is what a customer would have done.

---

## ADR-027 — An intent blocks the next one for as long as it can still be paid, and a Pass is bounded by what it costs to issue

**Date:** 2026-09-18
**Status:** Accepted
**Refines:** ADR-026 (the ownership rule, whose remaining gap this closes),
ADR-013 (the settlement grace it now aligns with), ADR-012 (sessions are rows,
which is why their count is a cost)
**Affects:** `domain/values.go`, `domain/pass_session.go`,
`database/payment.go`, `application/auth.go`, `httpapi/payment_handlers.go`,
`httpapi/catalog_handlers.go`, migration `000019`, `POST /purchases`,
the catalogue write endpoints, `types/payment.ts`, `use-purchase-flow.ts`

### Problem

Three findings from an audit of the purchase and catalogue surfaces. Two are
the same shape as the bug that prompted it: a rule the browser enforced and
nothing under it did.

1. **A Pass could be sold with any number of sessions.** The Pass form has
   always said "Enter 500 or fewer"; `NewSessionCount` accepted any positive
   `int32`. Every session becomes a row at purchase time (ADR-012), so the
   count is not a form field once somebody buys — it is one struct and one
   `INSERT` each, inside the transaction that issues the Pass. Measured: a
   20,000-session Pass took 20,000 single-row inserts and about a second of one
   transaction; a two-billion-session Pass is hundreds of gigabytes of slice
   capacity and a fatal out-of-memory in the settlement worker, which no
   `recover()` catches. Both cost the buyer one Luna.

2. **The catalogue had no rate limit at all.** Auth, payment, redemption, media
   and pass sessions each had one. A single authenticated wallet could create
   providers, services and passes as fast as it could post, and since ADR-025
   adopts the login wallet as the payout wallet, each new provider reaches the
   public directory and each ACTIVE Pass reaches Discover with no step in
   between.

3. **An expired intent could still be paid while a new one was being issued.**
   ADR-026 refuses a second purchase of a Pass the customer already holds, and
   refuses it at intent creation. That left the case where no pass exists yet:
   an intent is *payable* for five minutes longer than it is *current* —
   `Submit`, `DueDiscoveryAddresses` and `validateEvidence` all work until
   `expires_at + PurchaseSettlementGrace`, so a QR payment made in time but
   noticed late still settles — while the reuse predicate in `Create` used
   `expires_at`. For those five minutes the customer could hold one intent that
   could still buy the Pass and be issued a second that also could. Reproduced:
   two payments, two passes.

### Decision

**A Pass may be sold with 1 to 500 sessions.** `domain.MaxSessionsPerPass` is
the authority; `NewSessionCount` refuses anything outside it, and
`NewPassSessions` refuses it again *before* the allocation, because the count
that reaches `make` has not always been through the first gate. Migration
`000019` states the same bound on `passes.session_count` and
`purchased_passes.original_sessions` as `CHECK … NOT VALID`, so a write that
bypassed the application entirely is still refused. The session rows are now
written by one `unnest` insert instead of one statement per session: the cap is
what bounds the damage, and the bulk write is what makes the work proportionate
to it.

`NOT VALID` is deliberate. It enforces every insert and update from here and
scans nothing already stored. A row above the limit can only have come from a
request that bypassed the form, and the two ways to make a validating
constraint pass — rewriting a provider's session count, or deleting their Pass
— are not a migration's decision. The migration names the queries that find
such rows.

**Catalogue writes are behind the same limiter as everything else.** Provider
and service create/update, Pass create/update, publish, unpublish and archive
share one per-identity bucket and one per-IP bucket, answering the API's
ordinary `429 RATE_LIMITED`. Reads are untouched: limiting those would turn a
burst guard into an outage. Neither number is a business quota — that is a
separate product question, and this patch deliberately does not answer it.

**An intent blocks the next one for exactly as long as it can still be paid.**
The blocking window is now `expires_at + PurchaseSettlementGrace`, the same
window `Submit`, discovery and the verifier already used. A request inside the
tail is **refused** with `409 PURCHASE_IN_SETTLEMENT` rather than handed the old
intent, because an expired intent cannot start a payment —
`BeginWalletAttempt` requires `now < expires_at` — and returning one would give
the customer a checkout that silently does nothing.

### Why refusing, and not reconciling it later

The alternative was to let the second intent exist and decline to issue a
second Pass when it settles. That trades a refusal the customer can act on for
a payment taken against nothing, which is the one outcome the settlement design
exists to avoid; `COMPENSATION_REQUIRED` is a human case, not a mechanism to
route ordinary traffic through. Cancelling the first intent instead is worse:
the payment it is waiting for may already be on chain, and cancelling stops
discovery from ever finding it.

The refusal clears itself. Once the grace is over the old intent can settle
nothing, and the next request creates a new one.

### Consequences

`PURCHASE_IN_SETTLEMENT` is a new code on `POST /purchases`, wrapping
`ErrConflict` like its neighbours, so existing conflict handling keeps working.
It is the only refusal on the checkout screen that does not say "you have not
been charged" — it cannot, because the attempt it protects may well have been
paid — and it is the only one whose copy says not to pay again.

A provider's ability to spend a customer's sessions unilaterally was examined
in the same audit and deliberately **not** changed: ADR-012 decided it, and
customer approval or a dispute route is a separate product decision. The risk
and the exact audit trail behind it are written down in `09-SECURITY.md §41a`.
