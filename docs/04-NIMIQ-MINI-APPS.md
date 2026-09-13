# Nimpass — Nimiq Mini Apps

> **Document type:** Nimiq Mini Apps platform and runtime source of truth  
> **Project:** Nimpass  
> **Status:** Active  
> **Audience:** Developers, AI coding agents, designers, product contributors  
> **Depends on:** `01-PRODUCT.md`, `02-USER-FLOWS.md`  
> **Related:** `03-DESIGN-SYSTEM.md`, `05-NIMIQ-PAY-INTEGRATION.md`, `06-COMPETITION.md`, `07-SCORING-STRATEGY.md`, `08-ARCHITECTURE.md`, `09-SECURITY.md`, `10-SUBMISSION-CHECKLIST.md`  
> **Documentation snapshot:** September 2026  
> **Primary purpose:** Define how Nimpass operates as a web-first application that also runs as a Nimiq Pay Mini App, what the Nimiq Mini Apps platform provides, which wallet capabilities are available, which integration constraints are binding, and where the boundary lies between Nimiq Pay and Nimpass.

## Primary official references

- Nimiq Mini Apps overview: `https://nimiq.dev/mini-apps`
- API reference: `https://nimiq.dev/mini-apps/api-reference`
- Nimiq Provider API: `https://nimiq.dev/mini-apps/api-reference/nimiq-provider`
- Mini App tutorial: `https://nimiq.dev/mini-apps/tutorials/mini-app-tutorial`
- Local Mini App development: `https://nimiq.dev/mini-apps/development/load-local-mini-app`
- Localization: `https://nimiq.dev/mini-apps/features/localization`
- Device Identifier: `https://nimiq.dev/mini-apps/features/device-identifier`
- Build with AI: `https://nimiq.dev/mini-apps/development/build-with-ai`
- FAQ: `https://nimiq.dev/mini-apps/faq`

---

# 1. Purpose of This Document

This document defines the relationship between:

```text
Nimpass
+
Nimiq Pay
+
Nimiq Mini Apps Framework
+
Nimiq Mini App SDK
+
Nimiq wallet capabilities
```

It exists so that developers and AI coding agents do not make incorrect assumptions about what Nimiq Pay does for Nimpass.

`01-PRODUCT.md` defines:

> What Nimpass is.

`02-USER-FLOWS.md` defines:

> How customers and providers use Nimpass.

`03-DESIGN-SYSTEM.md` defines:

> How Nimpass looks and behaves.

This document defines:

> How Nimpass fits into and interacts with the Nimiq Pay Mini Apps platform.

---

# 2. Scope Boundary

This document intentionally does **not** own every Nimiq-related implementation detail.

It defines platform behavior, runtime capabilities, integration boundaries and binding platform decisions.

It does **not** define the complete implementation for:

```text
payment verification
payment reconciliation
purchase persistence
transaction confirmation policy
signature serialization
cryptographic challenge format
replay-protection storage
database transactions
authorization policy
competition rules
competition scoring
submission process
```

Those responsibilities belong elsewhere.

Use:

```text
05-NIMIQ-PAY-INTEGRATION.md
→ exact payment implementation,
  confirmation,
  verification,
  reconciliation,
  failure recovery

06-COMPETITION.md
→ rules,
  eligibility,
  dates,
  submission requirements

07-SCORING-STRATEGY.md
→ 100-point competition strategy

08-ARCHITECTURE.md
→ application/system architecture,
  service boundaries,
  data flow,
  backend structure

09-SECURITY.md
→ wallet trust boundaries,
  signing challenges,
  replay protection,
  QR security,
  authorization controls

10-SUBMISSION-CHECKLIST.md
→ final release and submission gate
```

If a subject is described here and in one of those documents, this document should explain only the **Mini Apps platform relevance**.

---

# 3. Official Mental Model of a Nimiq Mini App

A Nimiq Mini App is fundamentally a:

> **web application running inside Nimiq Pay.**

Nimiq Pay behaves like a specialized browser environment.

The Mini App is loaded into a WebView.

When wallet functionality is needed, the web application communicates with wallet capabilities exposed by Nimiq Pay.

Conceptually:

```text
┌─────────────────────────────────────┐
│             Nimiq Pay               │
│                                     │
│  ┌───────────────────────────────┐  │
│  │            WebView            │  │
│  │                               │  │
│  │            Nimpass            │  │
│  │                               │  │
│  │       Responsive Web App      │  │
│  └───────────────┬───────────────┘  │
│                  │                  │
│        Mini App SDK / Provider      │
│                  │                  │
│                  ▼                  │
│          Nimiq Pay Host             │
│                  │                  │
│          Wallet Operations          │
└─────────────────────────────────────┘
```

The critical distinction is:

> **Nimiq Pay hosts and mediates wallet capabilities. It does not replace the Nimpass application.**

---

# 4. What Nimiq Pay Provides

Nimiq Pay provides the environment through which Nimpass can access wallet-mediated capabilities.

Relevant examples include:

```text
Nimiq account access

message signing

NIM transactions

network readiness information

block height information

native user approval dialogs

Nimiq Pay language context

optional device identifier

Mini App WebView hosting

Mini App deep-link entry
```

Nimiq Pay remains responsible for sensitive wallet operations.

The Mini App asks.

Nimiq Pay mediates.

The user approves sensitive operations.

The wallet performs the cryptographic action.

---

# 5. What Nimpass Owns

Nimpass remains responsible for its own product.

Nimpass owns:

```text
UI

routing

provider profiles

services

packages

purchases

passes

remaining session counts

redemptions

history

backend

database

application authorization

application state

business rules

error recovery

product UX
```

Nimiq Pay does **not** automatically:

```text
create Nimpass packages

store Nimpass passes

decrease session balances

manage provider profiles

maintain redemption history

verify Nimpass business rules

run the Nimpass backend
```

This boundary is fundamental.

---

# 6. Nimpass Platform Decision

Nimpass is:

> **WEB-FIRST and MINI-APP-COMPATIBLE.**

This is a binding product and architecture decision.

The canonical product is one responsive web application that can operate in more than one host context.

```text
                         NIMPASS

                  Responsive Web App
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
 Normal Web Browser              Nimiq Pay WebView
          │                             │
 Public/product UX              Product UX + wallet
          │                             │
          └──────────────┬──────────────┘
                         │
                         ▼
                   Nimpass Backend
```

There must not be:

```text
one unrelated browser product
+
one unrelated Mini App product
```

The same Nimpass product model must remain recognizable in both environments.

---

# 7. Web-First Does Not Mean “Not a Mini App”

Being web-first does not weaken Mini App compatibility.

Nimpass may be opened as:

```text
https://nimpass...
```

in a normal browser.

The same application may also be loaded inside:

```text
Nimiq Pay WebView
```

When opened inside Nimiq Pay, wallet capabilities become available through the Mini Apps integration.

The correct mental model is:

```text
NORMAL WEB

Nimpass
+
standard web capabilities
```

and:

```text
NIMIQ PAY

Nimpass
+
Nimiq wallet capabilities
+
Nimiq Pay host context
```

not:

```text
WEB Nimpass
≠
MINI APP Nimpass
```

---

# 8. Runtime Contexts

Nimpass must explicitly handle at least two runtime contexts.

## Standard Browser Context

Typical available capabilities:

```text
homepage

discovery

provider pages

package pages

public sharing

ordinary backend API access

provider management

non-wallet application features
```

Nimiq Pay-specific injected functionality may be unavailable.

The application must not crash because the host provider does not exist.

## Nimiq Pay Context

Typical additional capabilities include:

```text
Nimiq provider

wallet account access

message signing

NIM transactions

network status

Nimiq Pay language

optional Nimiq Pay device identifier
```

Wallet capabilities must be feature-detected.

---

# 9. Runtime Architecture

A wallet operation conceptually follows this path:

```text
Nimpass UI / application logic
        ↓
Mini App SDK / injected provider
        ↓
Nimiq Pay host
        ↓
native approval UI where required
        ↓
wallet operation
        ↓
result returned to Nimpass
```

Nimpass requests an operation.

Nimiq Pay controls whether and how the wallet operation executes.

Sensitive wallet actions cannot be silently bypassed by the Mini App.

---

# 10. Mini App SDK

For Nimiq provider access, use the official package:

```text
@nimiq/mini-app-sdk
```

The recommended provider initialization pattern uses:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
```

The SDK `init()` helper exists to wait for Nimiq Pay to expose the Nimiq provider before the application tries to use it.

Do not assume that the provider exists synchronously during the first JavaScript execution.

---

# 11. Provider Initialization Model

Provider readiness should be modeled explicitly.

Conceptual states:

```text
UNKNOWN

INITIALIZING

AVAILABLE

UNAVAILABLE

ERROR
```

Wallet-dependent actions should not execute before the integration is ready.

However:

> Provider initialization must not unnecessarily block public Nimpass content.

Bad:

```text
User opens a public package
        ↓
Entire page waits for wallet initialization
        ↓
User cannot even read the offer
```

Preferred:

```text
Package page renders
        ↓
User understands the offer
        ↓
Wallet capability is initialized or requested
when the user reaches a wallet-dependent action
```

---

# 12. Provider Capability Detection

Nimpass must not blindly assume:

```text
Nimiq provider exists
```

in every host environment.

Browser-safe code must account for:

```text
ordinary desktop browser

ordinary mobile browser

Nimiq Pay WebView

local development environment

provider timeout

provider initialization failure
```

The application should degrade gracefully.

Public browsing must remain functional even when wallet functionality is unavailable.

---

# 13. Relevant Nimiq Provider Methods

The Nimiq Provider API exposes multiple blockchain operations.

The methods directly relevant to the current Nimpass product include:

```text
listAccounts()

sign()

isConsensusEstablished()

getBlockNumber()

sendBasicTransaction()

sendBasicTransactionWithData()
```

The provider may expose additional functionality.

That does not mean Nimpass should implement it.

A capability belongs in Nimpass only when it strengthens the service-pass lifecycle.

---

# 14. `listAccounts()`

`listAccounts()` requests the user's available Nimiq account addresses.

Conceptually:

```ts
const accounts = await nimiq.listAccounts()
```

This operation requires user confirmation.

Potential Nimpass uses include:

```text
wallet context

customer wallet selection

provider payment address context

wallet-linked pass access

wallet ownership flow
```

Important:

> An address returned by the provider can participate in identity and ownership flows, but the exact account-binding and authorization design belongs in `08-ARCHITECTURE.md` and `09-SECURITY.md`.

---

# 15. Wallet Address Is Not a Password

A Nimiq wallet address is public information.

Knowing an address is not proof that the current user controls that address.

Incorrect:

```text
client sends:

NQ...

        ↓

backend assumes:

this user controls that wallet
```

The application must use an appropriate wallet-mediated proof when actual wallet control must be demonstrated.

`sign()` may be used as part of such a design.

The exact proof protocol belongs in `09-SECURITY.md`.

---

# 16. `sign()`

The Nimiq provider supports message signing.

Conceptually:

```ts
const signed = await nimiq.sign(message)
```

The result includes signature-related cryptographic data.

Signing requires user confirmation.

Potential Nimpass uses may include:

```text
wallet ownership challenge

authentication challenge

sensitive pass authorization

session redemption authorization
```

Do not invent a signing protocol directly inside random UI components.

The exact signed payload format, nonce rules, expiration rules, domain binding and replay protection belong in:

```text
09-SECURITY.md
```

---

# 17. Signing Messages Must Be Meaningful

If signing is used, the user should not be asked to approve meaningless application messages.

Avoid conceptual patterns such as:

```text
sign "123456"

sign "hello"

sign "confirm"

sign an unexplained random string
```

A security design should bind the signature to a clear intended action.

For example, a redemption authorization may conceptually include:

```text
application

action

pass reference

redemption reference

nonce

expiration

expected origin/domain
```

This list is conceptual only.

The canonical signing format is owned by `09-SECURITY.md`.

---

# 18. `sendBasicTransaction()`

The Nimiq provider supports basic NIM payments.

Conceptually:

```ts
const txHash = await nimiq.sendBasicTransaction({
  recipient,
  value,
})
```

Relevant parameters include:

```text
recipient

value in Luna

optional fee

optional validity start height
```

The operation requires user confirmation.

The returned transaction hash is a blockchain transaction result.

It is **not** by itself the complete Nimpass purchase state.

Exact payment verification and reconciliation belong in:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

---

# 19. NIM and Luna

NIM transaction values use Luna as the smallest unit.

```text
1 NIM = 100,000 Luna
```

Therefore:

```text
250 NIM
```

corresponds to:

```text
25,000,000 Luna
```

Nimpass must maintain a clean distinction between:

```text
DISPLAY AMOUNT

250 NIM
```

and:

```text
TRANSACTION AMOUNT

25,000,000 Luna
```

Critical amount handling must not depend on unsafe floating-point behavior.

The conversion layer must be centralized and tested.

---

# 20. `sendBasicTransactionWithData()`

The Nimiq provider also supports a basic transaction with attached text data.

Conceptually:

```text
sendBasicTransactionWithData(...)
```

The existence of this capability does not mean Nimpass must use it.

If transaction data is ever considered, do not place sensitive application data on-chain.

Do not include:

```text
customer PII

private package details

authentication secrets

database identifiers that should remain private

long-lived tokens

private redemption data
```

Whether Nimpass uses a plain transaction or transaction-with-data is a payment architecture decision owned by:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

---

# 21. Network Readiness Methods

The provider exposes:

```text
isConsensusEstablished()
```

and:

```text
getBlockNumber()
```

`isConsensusEstablished()` can indicate whether the wallet has established Nimiq network consensus.

`getBlockNumber()` exposes the current blockchain height.

These may be useful for integration logic or diagnostics.

They should not be displayed in the ordinary customer UI merely to make Nimpass appear more blockchain-oriented.

The user generally does not need:

```text
block height

network telemetry

raw provider state
```

to understand a session pass.

---

# 22. NIM-First Product Decision

Nimpass MVP is intentionally centered on:

```text
NIM
```

for package payments.

The Mini Apps platform may support additional blockchain environments and assets.

That does not require Nimpass to expose them.

Current product decision:

```text
PRIMARY PACKAGE PAYMENT CURRENCY

NIM
```

Reasons include:

```text
clear product story

strong Nimiq integration

lower UX complexity

lower payment fragmentation

smaller implementation scope

consistent customer experience
```

Additional payment assets require an explicit future product decision.

---

# 23. Nimpass Nimiq Capability Map

Nimiq should appear where it strengthens the actual Nimpass lifecycle.

```text
PACKAGE PURCHASE
→ NIM transaction

WALLET CONTEXT
→ Nimiq account

PASS OWNERSHIP
→ wallet association

SENSITIVE AUTHORIZATION
→ wallet signature where architecture requires it

SESSION REDEMPTION
→ wallet-backed authorization where appropriate

REPEAT USAGE
→ same wallet-linked pass context
```

This is the intended integration philosophy.

Nimiq is infrastructure supporting the product.

It must not become decorative blockchain noise.

---

# 24. Native Approval Is Part of the Trust Model

Sensitive wallet operations are approved through Nimiq Pay's native confirmation experience.

Nimpass must not bypass or imitate that security boundary.

Nimpass may explain what is about to happen:

```text
10 Personal Training Sessions

250 NIM

Continue with Nimiq Pay
```

Then the wallet operation is requested.

Nimpass must **not** build a fake Nimiq Pay confirmation UI intended to capture credentials or simulate wallet approval.

Native approval belongs to Nimiq Pay.

---

# 25. Private Keys Must Never Enter Nimpass

Nimpass must never request, collect, transmit, reconstruct or store a user's Nimiq private key or seed phrase.

Do not implement:

```text
private-key input

seed-phrase input

wallet recovery phrase form

custom wallet vault

private-key export

wallet-password capture

fake wallet unlock UI
```

Private cryptographic material remains inside the wallet environment.

This is a hard boundary.

---

# 26. Wallet State and Application State Are Different

Keep these concepts separate.

```text
WALLET STATE

available Nimiq accounts
wallet approval
transaction submission
signature
network readiness
```

versus:

```text
APPLICATION STATE

provider
service
package
purchase
pass
remaining sessions
redemption
history
```

Nimiq Pay owns wallet-mediated operations.

Nimpass owns business state.

Do not make React components treat a wallet result as a complete application state transition.

---

# 27. Transaction Result Is Not Pass State

This is a critical cross-document rule.

A transaction hash means:

```text
a wallet transaction was submitted / returned
```

It does not automatically mean:

```text
a valid Nimpass pass definitely exists
```

Conceptually:

```text
wallet operation
        ↓
transaction result
        ↓
Nimpass payment verification / reconciliation
        ↓
authoritative purchase state
        ↓
pass creation
```

The exact confirmation policy and authoritative payment checks belong in:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

---

# 28. Wallet-Linked Pass Ownership

A purchased pass should be associated with the correct customer/wallet context.

Conceptually:

```text
PASS

belongs to

AUTHORIZED CUSTOMER / WALLET CONTEXT
```

A pass must not become usable merely because someone knows:

```text
pass ID

pass URL

QR screenshot
```

The Mini Apps platform provides wallet capabilities that can participate in ownership proof.

The complete authorization model belongs in:

```text
09-SECURITY.md
```

---

# 29. Redemption and Nimiq

Nimpass has the opportunity to use Nimiq beyond a one-time checkout.

Conceptually:

```text
NIM payment
+
wallet-linked pass
+
wallet-backed authorization where appropriate
```

A secure redemption flow may involve:

```text
active pass

short-lived challenge

provider validation

wallet authorization where required

server verification

exactly one session consumed
```

This document establishes only the platform opportunity and boundary.

The exact challenge, signature, QR, replay and authorization protocol belongs in:

```text
09-SECURITY.md
```

---

# 30. QR Is Not a Nimiq Identity Primitive

Nimiq Pay does not make possession of a QR code equivalent to wallet ownership.

A QR used by Nimpass is an application interaction mechanism.

Therefore:

```text
QR possession
≠
wallet ownership
```

and:

```text
QR screenshot
≠
permanent right to redeem
```

Exact QR contents and verification rules belong in:

```text
09-SECURITY.md
```

---

# 31. User Rejection Is a Normal Outcome

Wallet requests may be rejected by the user.

For example:

```text
listAccounts()

sign()

sendBasicTransaction()
```

may require native approval.

A rejected request should not be treated as an application crash.

The application should distinguish:

```text
user cancelled

provider unavailable

invalid request

network failure

backend failure
```

The UI should provide a recoverable state.

---

# 32. Provider Errors Must Be Normalized

Provider-specific errors should not leak directly into ordinary user-facing UI.

Internal error:

```text
PermissionDeniedError
```

may become:

```text
Payment cancelled.
You were not charged.
```

Internal error:

```text
InvalidTransactionError
```

may become:

```text
Payment couldn't be completed.
Please try again.
```

Preserve useful technical context in safe logs.

Expose human-readable states to users.

---

# 33. Nimiq Pay Language

Nimiq Pay exposes its selected language to Mini Apps through:

```js
window.nimiqPay?.language
```

The value is an ISO 639-1 two-letter language code.

When Nimpass runs inside Nimiq Pay, the Nimiq Pay language should take precedence when supported.

Conceptual fallback:

```text
Nimiq Pay language
        ↓
browser/device language
        ↓
English
```

Example:

```js
const language =
  window.nimiqPay?.language
  || navigator.language.split('-')[0]
  || 'en'
```

Outside Nimiq Pay:

```text
window.nimiqPay
```

may be undefined.

Always account for that.

---

# 34. Device Identifier

Nimiq Pay can provide a pseudonymous per-device identifier through the Mini App SDK.

The official device identifier is:

```text
64-character hexadecimal SHA-256 value
```

scoped to:

```text
device + mini-app origin
```

The first request for an origin requires consent and presents the provided reason to the user.

This feature is optional.

Nimpass must not request it simply because the API exists.

---

# 35. Device Identifier Is Not User Identity

The Nimiq Pay device identifier identifies a device context.

It does not identify a person.

The same user on two devices may receive different identifiers.

A shared device may produce the same identifier for different users of the same Mini App origin.

Therefore never use the device identifier as:

```text
primary customer identity

wallet ownership proof

pass ownership proof

replacement for wallet authorization
```

Potential future uses may include:

```text
abuse prevention

device-level rate limiting

anti-spam

security telemetry
```

Any use must have a concrete product/security reason.

---

# 36. Device Identifier Consent

The reason supplied when requesting a device identifier is shown to the user.

Therefore the reason must be:

```text
truthful

specific

necessary

understandable
```

Bad:

```text
Required
```

Better:

```text
Help protect session redemption from automated abuse.
```

Do not request device-level identification unless Nimpass genuinely needs it.

---

# 37. Framework-Agnostic Frontend Support

The Nimiq Mini Apps Framework is frontend-framework agnostic.

A Mini App is not required to use a specific JavaScript framework.

The current Nimpass frontend stack:

```text
React

Vite

TypeScript

Tailwind CSS

shadcn/ui

Lucide Icons
```

is compatible with the Mini Apps model.

The Mini Apps integration should not force a second frontend stack.

---

# 38. Backend Freedom

Nimiq Mini Apps may use their own:

```text
backend

database

APIs

authentication

business logic
```

Nimpass therefore retains its own backend for application state such as:

```text
providers

services

packages

purchases

passes

redemptions

history

authorization

payment reconciliation
```

Do not assume Nimiq Pay hosts the Nimpass backend.

---

# 39. Frontend Secrets Rule

Anything shipped in the frontend bundle must be treated as visible to users.

Do not put secret values into Vite-exposed frontend code.

Examples of secrets that belong server-side include:

```text
private API credentials

server signing secrets

database credentials

backend-only authentication secrets
```

Frontend-safe configuration may include explicitly public values such as:

```text
public backend URL

public application origin

public network selection
```

The detailed environment-variable architecture belongs in:

```text
08-ARCHITECTURE.md
```

Security classification belongs in:

```text
09-SECURITY.md
```

---

# 40. Mini App Deep Links

Nimiq Pay supports links that open a web application directly as a Mini App.

Current official patterns include:

```text
Nimiq Pay custom-scheme Mini App link

Nimiq Pay HTTPS Mini App opener
```

Conceptual custom scheme:

```text
nimiqpay://miniapp?url=...
```

Conceptual HTTPS opener:

```text
https://nimpay.app/miniapps/open/...
```

The production implementation must follow the current official Nimiq format at implementation time.

Do not hardcode stale examples without checking the current Developer Center.

---

# 41. Browser → Nimiq Pay Transition

Because Nimpass is web-first, this is an important customer flow:

```text
Customer opens package in normal browser
        ↓
Customer reads package
        ↓
Customer chooses Buy Pass
        ↓
wallet capability becomes necessary
        ↓
Open / continue inside Nimiq Pay
        ↓
same Nimpass package context
        ↓
customer confirms NIM payment
```

The transition should feel like continuing the same product.

It must not feel like being sent to an unrelated application.

---

# 42. Preserve Context Across Deep Link

Bad:

```text
Customer views:
10 Personal Training Sessions

        ↓

Open in Nimiq Pay

        ↓

generic Nimpass homepage
```

Preferred:

```text
Customer views:
10 Personal Training Sessions

        ↓

Open in Nimiq Pay

        ↓

same package
```

Where appropriate, the deep-linked route may preserve identifiers such as:

```text
provider context

package context

purchase flow context
```

But context preservation must not make arbitrary URL parameters authoritative financial data.

---

# 43. Deep-Link Trust Boundary

A deep link identifies application context.

It must not be trusted as the source of truth for sensitive payment values.

Never design a payment flow where arbitrary URL input such as:

```text
recipient=NQ_ATTACKER

price=1
```

becomes trusted transaction data.

Authoritative values such as:

```text
payment recipient

package price

session quantity

purchase terms
```

must come from trusted application/backend state.

Exact payment rules belong in:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

---

# 44. Sharing Nimpass Packages

A provider may share a normal Nimpass package URL.

Where useful, Nimpass may additionally provide a Mini App-oriented entry.

Potential UI actions:

```text
Copy Link

Open in Nimiq Pay
```

Users should not need to understand:

```text
WebViews

provider injection

host bridges
```

to use the product.

---

# 45. Local Development

Nimiq Pay can load a locally running web application during development.

A common setup is:

```text
development machine
+
phone/emulator with Nimiq Pay
+
same local network
+
Vite server reachable over LAN
```

For Vite, network access should be enabled.

Conceptually:

```ts
export default defineConfig({
  server: {
    host: true,
  },
})
```

or:

```bash
npm run dev -- --host
```

Use the current Nimiq local-development documentation when configuring the real project.

---

# 46. Local HMR Consideration

In some environments, particularly Docker or non-standard local networking, Vite HMR may require explicit host configuration.

The current Nimiq development documentation includes an approach using:

```text
VITE_HMR_HOST
```

and Vite `server.hmr` configuration when needed.

Do not add custom HMR complexity unless the normal LAN development flow actually requires it.

---

# 47. Secure-Context Difference During Local Testing

Local LAN development may use:

```text
http://<local-ip>:5173
```

rather than HTTPS.

Some browser APIs require a secure context.

An API that works on:

```text
localhost
```

may not work on:

```text
LAN HTTP
```

inside a mobile WebView.

For example, secure-context-only APIs such as:

```text
crypto.randomUUID()
```

may require feature detection and an appropriate fallback.

Security-sensitive server identifiers should preferably originate from the backend where the architecture allows.

---

# 48. Testnet

Nimiq Pay provides a development path for testing with Nimiq testnet.

Payment development should use testnet where appropriate.

Do not repeatedly test normal development flows with real production funds.

The current official development documentation should be followed for:

```text
switching Nimiq Pay to testnet

obtaining testnet NIM

testing wallet operations
```

---

# 49. Mainnet and Testnet Must Be Explicit

Nimpass must know which network a transaction belongs to.

Never treat:

```text
testnet transaction
```

as:

```text
mainnet purchase
```

Network configuration must be explicit.

The detailed environment and reconciliation policy belongs in:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

and:

```text
08-ARCHITECTURE.md
```

---

# 50. Test Inside Nimiq Pay Early

Browser testing alone is insufficient.

The actual Nimiq Pay environment must be tested during development because it affects:

```text
provider injection

native approval UI

WebView behavior

wallet interaction

deep links

mobile layout

host language

network behavior
```

Do not postpone Nimiq Pay testing until the end of the project.

---

# 51. Browser Testing Is Also Required

Nimiq Pay testing alone is also insufficient because Nimpass is web-first.

Minimum meaningful product environments include:

```text
desktop browser

mobile browser

Nimiq Pay WebView
```

Critical customer Mini App flows must work inside Nimiq Pay.

Public/customer web flows must work outside it.

Provider operational interfaces should remain excellent in ordinary web environments.

---

# 52. Mobile WebView Requirements

Nimiq Pay is a mobile host environment.

Mini-App-critical customer screens must therefore remain comfortable on constrained mobile dimensions.

Important examples:

```text
package detail

purchase

payment state

My Passes

pass detail

session redemption

QR/code presentation

history
```

Provider administration may remain web-first, but customer Mini App flows must not depend on desktop-only layout.

---

# 53. Do Not Depend on Hover

Critical customer functionality must not rely exclusively on:

```text
hover

right click

desktop keyboard shortcut

wide table action

mouse-only interaction
```

Anything required to:

```text
buy

access a pass

authorize

redeem

recover from error
```

must remain usable through touch-friendly interaction.

---

# 54. Safe-Area Awareness

The Nimiq Pay WebView runs inside a mobile application.

Critical controls should not be positioned in a way that conflicts with:

```text
system UI

device notches

home indicators

host navigation

unsafe screen edges
```

Exact safe-area styling belongs in:

```text
03-DESIGN-SYSTEM.md
```

This document only establishes the Mini App requirement.

---

# 55. Progressive Wallet Access

Do not request wallet access simply because a page loaded.

For example, avoid calling:

```text
listAccounts()
```

on every anonymous visit without a product reason.

Preferred model:

```text
browse freely

read provider

read package

understand offer

        ↓

wallet interaction only when required
```

Meaningful wallet moments include:

```text
Buy Pass

Open wallet-owned private pass content

Authorize sensitive session action
```

This reduces confirmation fatigue.

---

# 56. Avoid Confirmation Fatigue

Sensitive wallet operations may trigger native user confirmation.

Poor experience:

```text
open homepage
→ wallet prompt

open provider
→ wallet prompt

open package
→ wallet prompt

press buy
→ another wallet prompt
```

Preferred:

```text
browse without unnecessary prompts

request wallet action at a meaningful user-initiated moment
```

Wallet approval should feel intentional.

---

# 57. Application Recovery

Nimpass must expect runtime interruptions such as:

```text
WebView reload

application backgrounding

browser refresh

wallet cancellation

network interruption

route change
```

Critical Nimpass state must not live only in transient React memory.

Examples of state that may require authoritative persistence include:

```text
purchase state

pass state

remaining sessions

redemption state
```

Exact persistence rules belong in:

```text
08-ARCHITECTURE.md
```

---

# 58. Centralize Nimiq Integration

Nimiq-specific frontend logic should live behind a dedicated integration layer.

Conceptually:

```text
src/
  lib/
    nimiq/
      provider.ts
      environment.ts
      payments.ts
      signing.ts
      amounts.ts
      errors.ts
```

Exact file names are not binding.

The rule is:

> Do not scatter raw Mini App SDK calls throughout unrelated React components.

UI components should consume application-oriented interfaces.

---

# 59. Suggested Adapter Responsibilities

A Nimpass Nimiq adapter may expose application-oriented operations such as:

```text
initializeNimiq()

isNimiqPayEnvironment()

requestAccounts()

sendNimPayment()

signChallenge()

getNetworkStatus()

normalizeNimiqError()

nimToLuna()

lunaToNim()
```

These are **Nimpass wrapper names**.

They are not official Nimiq provider method names unless the official API says otherwise.

Internally, wrappers should use documented provider methods.

This distinction prevents AI coding agents from confusing project abstractions with the external SDK.

---

# 60. Environment Detection

Environment detection should answer questions such as:

```text
Are we inside Nimiq Pay?

Is the Nimiq provider available?

Is initialization still pending?

Can this action run here?

Should the user continue in Nimiq Pay?
```

Do not implement environment detection by brittle UI assumptions such as:

```text
mobile device = Nimiq Pay
```

or:

```text
Safari = normal browser
```

Detect actual capabilities and host context.

---

# 61. Error Normalization

Nimiq integration errors should be normalized into Nimpass application errors.

Potential internal categories:

```text
USER_CANCELLED

PROVIDER_UNAVAILABLE

PROVIDER_TIMEOUT

INVALID_TRANSACTION

NETWORK_UNAVAILABLE

NO_ACCOUNT

UNKNOWN_PROVIDER_ERROR
```

Exact naming is an implementation decision.

The important rule is:

```text
external provider error
        ↓
integration adapter
        ↓
normalized Nimpass error
        ↓
human-readable UI
```

---

# 62. Logging Rule

Do not log sensitive wallet or application data unnecessarily.

Avoid routine logs containing:

```text
full private customer data

secret tokens

signature challenge secrets

private backend credentials

unnecessary wallet-linked behavioral history
```

Logging should be useful for diagnosis without becoming a data leak.

Detailed logging/security policy belongs in:

```text
09-SECURITY.md
```

---

# 63. Nimiq AI Skill

Nimiq officially provides an AI skill for Mini Apps development.

Where supported, install it for AI coding tools working on Nimpass.

Current documented installation command:

```bash
npx skills add nimiq/developer-center --skill mini-apps
```

The skill provides current Mini Apps context to compatible AI coding agents.

It does not replace the Nimpass project documentation.

The intended relationship is:

```text
Nimiq official Mini Apps skill
→ platform knowledge

Nimpass docs
→ product and project decisions
```

Both are needed.

---

# 64. AI Agent Source Priority

AI coding agents must not rely on remembered generic Web3 patterns when current Nimiq documentation is available.

Source priority for Nimiq platform behavior:

```text
1. Current Nimiq Developer Center
2. Current official Mini Apps API reference
3. Current official SDK documentation/examples
4. Nimpass project documentation
5. Old tutorials / random examples / generic Web3 assumptions
```

When official current Nimiq documentation conflicts with this file regarding external platform behavior:

> **Current official Nimiq documentation wins.**

Then this project document should be updated.

---

# 65. AI Agents Must Not Invent Provider Methods

Do not invent APIs such as:

```text
nimiq.connectWallet()

nimiq.pay()

nimiq.getUser()
```

unless the current official SDK actually defines them.

Use documented APIs.

Current relevant Nimiq provider methods include:

```text
listAccounts()

sign()

isConsensusEstablished()

getBlockNumber()

sendBasicTransaction()

sendBasicTransactionWithData()
```

Use the official API reference before adding provider calls.

---

# 66. Things an AI Agent Must Never Assume

An AI coding agent must not assume:

```text
Nimiq Pay hosts the Nimpass backend.

Nimiq Pay stores Nimpass passes.

Nimiq Pay manages remaining-session counts.

Nimiq Pay automatically verifies Nimpass purchases.

A wallet address string alone proves wallet control.

A pass URL proves ownership.

A QR screenshot proves ownership.

A submitted blockchain transaction automatically creates a pass.

Mini Apps must use React.

Mini Apps cannot use a backend.

Nimpass must be mobile-only.

Nimpass requires Ethereum.

Nimpass requires a smart contract.

Nimiq Pay exposes private keys to Nimpass.

Every Nimiq capability should be implemented.
```

These assumptions are incorrect, unsupported, or contrary to Nimpass decisions.

---

# 67. Things an AI Agent Should Know

An AI agent working on Nimpass should understand:

```text
Nimpass is a responsive web application.

Nimpass also runs inside Nimiq Pay.

Nimiq Pay loads Mini Apps in a WebView.

Wallet capabilities are mediated through injected providers / the Mini App SDK.

@nimiq/mini-app-sdk is used for Nimiq provider access.

init() is used to wait for provider availability.

Sensitive wallet actions require native user approval.

Private keys stay inside the wallet environment.

NIM transactions use Luna as the smallest unit.

1 NIM = 100,000 Luna.

Nimpass has its own backend and database.

NIM is the primary package-payment currency for the MVP.

Wallet context contributes to pass ownership.

Wallet signing may participate in sensitive authorization.

Public web pages must work outside Nimiq Pay.

Critical customer Mini App flows must work well on mobile.

Nimiq-specific frontend code should be centralized.

Current official Nimiq documentation overrides stale examples.
```

---

# 68. Nimpass Mini App P0 Platform Requirements

Before Nimpass can be considered properly integrated with the Mini Apps platform, the following platform-level capabilities must work:

```text
Nimpass loads correctly in an ordinary browser.

Nimpass loads correctly inside Nimiq Pay.

Public content does not crash when the provider is unavailable.

Mini App SDK initialization works.

Nimiq Pay wallet capabilities are feature-detected.

Wallet account access works when intentionally requested.

A real NIM transaction can be requested through the documented provider.

Wallet cancellation returns to a recoverable Nimpass state.

NIM ↔ Luna conversion is correct.

Nimiq Pay native approval remains authoritative for wallet actions.

The application never requests private keys or seed phrases.

Browser → Nimiq Pay continuation preserves relevant product context.

Testnet and mainnet configuration are explicit.

Critical customer layouts work inside the mobile WebView.

The Nimiq integration is isolated behind a maintainable adapter layer.
```

Payment confirmation correctness is additionally gated by:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

Security correctness is additionally gated by:

```text
09-SECURITY.md
```

---

# 69. What Does Not Belong in This File

Do not grow this document back into a catch-all Nimpass handbook.

The following belong elsewhere.

## Competition details

Do not keep here:

```text
cycle dates

prize values

submission word limits

promotion checklist

full 100-point score breakdown

early-access campaign strategy

ranking strategy
```

Use:

```text
06-COMPETITION.md

07-SCORING-STRATEGY.md
```

## Exact payment architecture

Do not keep here:

```text
purchase-intent schema

confirmation threshold policy

transaction reconciliation algorithm

payment worker design

duplicate-payment algorithm

pass-creation transaction boundaries
```

Use:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

## Exact security protocol

Do not keep here:

```text
canonical signed message serialization

nonce storage format

signature verification implementation

QR token format

replay database schema

authorization matrix

cryptographic key policy
```

Use:

```text
09-SECURITY.md
```

## Full application architecture

Do not keep here:

```text
complete folder structure

database schema

GraphQL/API design

service dependency graph

deployment topology

observability architecture
```

Use:

```text
08-ARCHITECTURE.md
```

## Full UX specification

Do not keep here:

```text
visual tokens

button styling

safe-area CSS implementation

responsive component layouts

copy system

shadcn component rules

Lucide icon rules
```

Use:

```text
03-DESIGN-SYSTEM.md
```

This scope discipline is intentional.

---

# 70. Minimal Competition Relevance

Nimpass is being prepared for the Nimiq Mini Apps ecosystem and competition, but this file is not the competition handbook.

Only the following competition-relevant principle belongs here:

> Nimiq integration must be real and product-relevant rather than cosmetic.

For Nimpass, this means the product should use Nimiq capabilities where they naturally support:

```text
package purchase

wallet context

pass ownership

secure authorization

repeat usage
```

The full competition rules belong in:

```text
06-COMPETITION.md
```

The scoring strategy belongs in:

```text
07-SCORING-STRATEGY.md
```

---

# 71. Official Documentation Must Be Rechecked

The Mini Apps platform can evolve.

Before implementing an unfamiliar provider feature, changing wallet integration, or preparing a release:

```text
recheck the Mini Apps overview

recheck the API reference

recheck the Nimiq Provider API

recheck development documentation

recheck feature-specific documentation

recheck current SDK behavior
```

Do not freeze September 2026 documentation into permanent assumptions.

This file records Nimpass decisions.

The Nimiq Developer Center remains authoritative for external platform behavior.

---

# 72. Documentation Responsibility Split

The canonical documentation split is:

```text
01-PRODUCT.md

What Nimpass is
```

```text
02-USER-FLOWS.md

How customers and providers use Nimpass
```

```text
03-DESIGN-SYSTEM.md

How Nimpass looks and feels
```

```text
04-NIMIQ-MINI-APPS.md

How Nimpass operates inside
the Nimiq Pay Mini Apps platform
```

```text
05-NIMIQ-PAY-INTEGRATION.md

Exact payment implementation,
verification and reconciliation
```

```text
06-COMPETITION.md

Competition rules,
eligibility,
dates and submission process
```

```text
07-SCORING-STRATEGY.md

How Nimpass maximizes
the judging model
```

```text
08-ARCHITECTURE.md

System and software architecture
```

```text
09-SECURITY.md

Wallet trust boundaries,
signature challenges,
replay protection,
QR security,
authorization
```

```text
10-SUBMISSION-CHECKLIST.md

Final release and submission gate
```

Do not duplicate entire sections across these documents.

Cross-reference the authoritative document instead.

---

# 73. Source-of-Truth Rule

This file defines Nimpass's intended relationship with the Nimiq Mini Apps platform.

When:

```text
generated code

AI suggestion

old tutorial

generic Web3 pattern

random SDK example

Stack Overflow answer
```

conflicts with the current official Nimiq Mini Apps documentation:

> **Current official Nimiq documentation wins for platform behavior.**

When implementation conflicts with a documented Nimpass decision:

1. identify the conflict,
2. check current Nimiq platform constraints,
3. determine whether the Nimpass decision remains valid,
4. explicitly update the relevant source-of-truth document if the decision changes,
5. only then change the implementation.

Do not silently redefine the integration.

---

# 74. Final Mini App Principle

The simplest correct mental model is:

```text
NIMIQ PAY

provides the secure wallet environment,
native approval experience,
and wallet-mediated capabilities.
```

```text
NIMPASS

provides the actual recurring-service product:
providers,
packages,
purchases,
passes,
remaining sessions,
redemptions,
and history.
```

Together:

```text
Customer discovers a useful service
        ↓
Customer understands a multi-session package
        ↓
Customer pays with NIM
        ↓
Nimpass verifies the purchase
        ↓
Customer receives a wallet-linked digital pass
        ↓
Customer returns over time
        ↓
Sessions are securely redeemed
        ↓
Remaining sessions stay clear
```

The wallet technology should support the experience rather than dominate it.

The final customer should think:

> **“I bought ten sessions, I have seven left, and using one is easy.”**

not:

> **“I am interacting with an injected blockchain provider inside a WebView.”**

That distinction defines the intended Nimpass Mini App experience.
