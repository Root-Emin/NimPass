# Nimpass — Security Architecture

> **Document type:** Security architecture and trust-boundary source of truth
> **Project:** Nimpass
> **Status:** Active
> **Audience:** Developers, AI coding agents, security reviewers, product contributors
> **Depends on:** `01-PRODUCT.md`, `02-USER-FLOWS.md`, `04-NIMIQ-MINI-APPS.md`, `05-NIMIQ-PAY-INTEGRATION.md`
> **Related:** `08-ARCHITECTURE.md`, `10-SUBMISSION-CHECKLIST.md`
> **Security baseline:** Nimiq Mini Apps security model, OWASP web/API guidance, Nimpass domain invariants
> **Documentation snapshot:** September 2026
> **Primary purpose:** Define what Nimpass trusts, what it does not trust, how wallets and users are authenticated, how purchases and passes are authorized, how session redemptions are protected, and which security invariants must remain true throughout implementation.

---

# 1. Purpose

Nimpass manages assets with real economic value.

A pass is not merely UI.

It represents:

```text
prepaid service entitlement
+
NIM payment
+
wallet-linked ownership
+
remaining usable sessions
```

Therefore a security failure can cause:

```text
unauthorized pass access

payment misdirection

session theft

duplicate redemption

provider impersonation

privacy leakage

fraudulent pass creation

loss of purchased value
```

Security must therefore be part of the product architecture rather than a final deployment checklist.

---

# 2. Security Philosophy

The primary Nimpass security principle is:

> **Never trust a client-visible state transition as proof of an economic or authorization event.**

Examples:

```text
wallet popup closed successfully
≠
verified payment


customer possesses QR
≠
customer owns pass


user knows pass ID
≠
user can access pass


provider knows redemption ID
≠
provider may redeem it


frontend says remaining = 7
≠
server remaining = 7
```

Authoritative decisions happen server-side.

---

# 3. Security Goals

Nimpass must protect the following properties.

## Confidentiality

Unauthorized users must not gain access to:

```text
private passes

customer purchase relationships

session history

provider private information

security metadata

authentication sessions
```

## Integrity

Attackers must not be able to:

```text
change package price

change payment recipient

create fake passes

increase session balance

consume another customer's session

redeem one session twice

forge provider ownership
```

## Availability

Attackers must not easily disrupt:

```text
public browsing

payment verification

pass lookup

session redemption

provider operations
```

## Authenticity

Nimpass must be able to determine:

```text
which wallet authorized an action

which provider owns a payout wallet

which wallet owns a pass

which provider is allowed to redeem that pass
```

---

# 4. High-Value Assets

The primary protected assets are:

```text
provider accounts

provider payout-wallet mappings

customer wallet identities

purchase intents

transaction hashes

passes

remaining session counts

redemption challenges

redemption history

authentication sessions

authorization policies

database credentials

RPC/API credentials

server secrets

production infrastructure
```

Private wallet keys are **not** Nimpass assets because Nimpass must never receive or store them.

---

# 5. Core Trust Boundaries

Nimpass consists of several different trust zones.

```text
┌──────────────────────┐
│      CUSTOMER        │
│ Browser / Nimiq Pay  │
└──────────┬───────────┘
           │ UNTRUSTED CLIENT
           ▼
┌──────────────────────┐
│   NIMPASS FRONTEND   │
└──────────┬───────────┘
           │ API
           ▼
┌──────────────────────┐
│   NIMPASS BACKEND    │
│ AUTHORITATIVE DOMAIN │
└──────┬─────────┬─────┘
       │         │
       ▼         ▼
 DATABASE     NIMIQ NETWORK
                 │
                 ▼
             BLOCKCHAIN
```

Nimiq Pay forms an additional wallet-security boundary:

```text
NIMPASS MINI APP

        ↓ request

NIMIQ PAY

        ↓ native approval

USER WALLET
```

---

# 6. Client Trust Rule

The frontend is untrusted for authoritative business decisions.

Never trust client-provided:

```text
price

session quantity

provider ID without authorization checks

payment recipient

payment status

wallet ownership

remaining sessions

pass status

transaction confirmation

redemption result
```

Client input represents:

```text
requested action
```

not:

```text
verified truth
```

---

# 7. Nimiq Pay Security Boundary

Nimiq Pay mediates wallet operations.

Sensitive actions including account access, signing and NIM transactions require native user approval, and Mini Apps do not receive direct access to private keys.

Therefore Nimpass must never implement:

```text
private-key fields

seed phrase fields

wallet password forms

private-key export

wallet recovery

custom key storage
```

If any implementation introduces these features, it violates the Nimpass security model.

---

# 8. Nimiq Pay Is Not the Nimpass Authorization Server

Nimiq Pay can establish wallet-mediated cryptographic actions.

It does not know:

```text
which provider owns package X

whether pass Y is active

whether redemption Z was already used

whether package A contains 10 sessions

whether user B may manage provider C
```

These are Nimpass domain rules.

They must be enforced by Nimpass backend authorization.

---

# 9. Device Identifier Is Not Authentication

Nimiq Pay may expose a pseudonymous device identifier.

The official device identifier is scoped to the Mini App origin and device. It identifies a device, not a person; the same user can have different identifiers on different devices and multiple users on one device can share the same identifier. Nimiq explicitly says it should not be used as a user ID or authentication mechanism.

Therefore:

```text
deviceId
≠
wallet identity

deviceId
≠
customer account

deviceId
≠
pass owner
```

---

# 10. Optional Device Identifier Usage

If Nimpass later requests the device identifier, valid uses may include:

```text
abuse detection

rate-limit context

fraud telemetry

device-scoped security heuristics
```

It must not become a required user identity primitive.

The user's consent and the declared reason must remain truthful.

---

# 11. Wallet Identity

The primary crypto identity in Nimpass is:

```text
Nimiq wallet address
```

However:

```text
knowing an address
```

does not prove:

```text
controlling that address
```

Wallet control must be established through a wallet-mediated proof where required.

---

# 12. Wallet Authentication Model

The intended Nimpass wallet-authentication flow is challenge-response.

```text
User requests wallet sign-in
        ↓
Nimpass obtains/chooses wallet address
        ↓
Backend creates one-time auth challenge
        ↓
Customer signs challenge through Nimiq Pay
        ↓
Backend verifies signature
        ↓
Backend verifies signer wallet
        ↓
Challenge consumed
        ↓
Application session created
```

The Nimiq provider officially exposes both account access and message signing. `sign()` returns a public key and signature, and Nimiq's public-key API supports deriving an address and verifying signatures.

---

# 13. Authentication Challenge

Authentication challenges must be created by the server.

Never use:

```text
frontend random number only

timestamp only

wallet address only

"hello"

"login"
```

as the full authentication challenge.

The server challenge must contain an unpredictable nonce.

Conceptually:

```text
challengeId

nonce

walletAddress

purpose

issuedAt

expiresAt

origin/application identifier
```

---

# 14. Authentication Challenge Message

The customer should sign a human-readable message.

Conceptual message:

```text
Nimpass Wallet Authentication

Action: Sign in to Nimpass
Wallet: NQ...
Challenge: <nonce>
Issued At: <timestamp>
Expires At: <timestamp>
Origin: nimpass.example
```

Exact serialization must be deterministic.

The backend must reconstruct exactly the message it expects rather than trusting a client-submitted replacement message.

---

# 15. Challenge Binding

Authentication challenge must bind:

```text
purpose

wallet

nonce

application/origin

expiration
```

This prevents a signature intended for:

```text
login
```

from being reused as:

```text
redeem pass
```

or:

```text
verify provider wallet
```

---

# 16. Challenge TTL

Authentication challenges must expire quickly.

They must not remain reusable indefinitely.

Conceptually:

```text
CREATED
   ↓
SIGNED
   ↓
CONSUMED
```

Alternative:

```text
CREATED
   ↓
EXPIRED
```

An expired challenge cannot create a session.

---

# 17. Challenge One-Time Use

Once authentication succeeds:

```text
challenge.usedAt
```

must be recorded atomically.

Submitting the same valid signature again must not create unlimited new independent login proofs.

Server behavior:

```text
first valid use
→ consume challenge

later use
→ reject / return already-consumed result
```

---

# 18. Signature Verification

The backend must verify signatures using a maintained Nimiq-compatible cryptographic library.

Do not implement cryptographic primitives manually.

The server must verify:

```text
signature is valid

public key is valid

public key corresponds to expected wallet

signed message is exact expected message

challenge exists

challenge not expired

challenge not consumed

challenge purpose is correct
```

Nimiq's current Core API exposes public-key verification and address derivation functionality suitable for this purpose.

---

# 19. Never Trust Claimed Wallet Separately

Potential attack:

```text
attacker claims:

wallet = NQ-VICTIM

but signs using:

NQ-ATTACKER
```

Backend must derive/confirm the wallet from the returned public key and require:

```text
derivedSignerWallet
=
challenge.walletAddress
```

Otherwise authentication fails.

---

# 20. Separate Signature Purposes

Use domain-separated signature purposes.

Examples:

```text
AUTH_LOGIN

VERIFY_PROVIDER_WALLET

AUTHORIZE_REDEMPTION
```

Never reuse identical signing messages between security domains.

---

# 21. Provider Payout Wallet Verification

A provider must prove control of the payout wallet before it can become trusted.

Flow:

```text
Provider chooses payout wallet
        ↓
Backend creates VERIFY_PROVIDER_WALLET challenge
        ↓
Provider signs challenge
        ↓
Backend verifies signer
        ↓
Wallet marked VERIFIED
```

Only:

```text
VERIFIED payout wallets
```

can become authoritative payment recipients.

---

# 22. Payout Wallet Change

Changing a provider payout wallet is security-sensitive.

Recommended flow:

```text
authenticated provider

        ↓

request payout-wallet change

        ↓

prove control of new wallet

        ↓

persist VERIFIED new wallet

        ↓

audit event
```

Existing active purchase intents keep their snapshotted recipient as defined in `05-NIMIQ-PAY-INTEGRATION.md`.

---

# 23. Payout Wallet Change Protection

A stolen provider web session must not make silently replacing the payout address trivial.

Additional protections may include:

```text
fresh wallet signature

recent-authentication requirement

explicit confirmation

rate limit

security notification

audit trail
```

depending on final provider-auth model.

---

# 24. Purchase Trust Model

Purchase security depends on:

```text
trusted package data

trusted payout recipient

trusted NIM amount

blockchain verification

unique transaction use

atomic pass creation
```

The frontend cannot establish any of these alone.

---

# 25. Payment Verification

Before creating an active pass, backend must verify:

```text
transaction exists

correct network

correct recipient

exact value

expected purchase reference

transaction acceptable under confirmation policy

transaction hash not already used

purchase intent valid

purchase not already completed
```

This requirement is defined in detail in:

```text
05-NIMIQ-PAY-INTEGRATION.md
```

---

# 26. Transaction Hash Is Not Authorization

Knowing a valid transaction hash does not grant access to the resulting pass.

A transaction hash is not an authentication token.

Never implement:

```text
GET /pass?tx=<hash>
→ reveal pass
```

without ownership authorization.

---

# 27. No Secrets in Frontend

Anything shipped in the Mini App/frontend bundle is visible to users.

Nimiq's own Mini App guidance therefore says API keys, signing secrets and credentials must not be embedded in client code; secret-bearing external calls should be routed through a backend.

Never expose:

```text
database credentials

server signing keys

JWT/session signing keys

private RPC credentials

third-party API secrets

internal admin tokens
```

through Vite/client environment variables.

---

# 28. Public Repository Threat Model

Competition requires a public GitHub repository.

Therefore Nimpass must assume attackers can inspect:

```text
frontend source

backend source

API routes

GraphQL schema if used

validation logic

route names

database migrations

business rules
```

Security must never depend on:

```text
attacker does not know how code works
```

The system must remain secure with source code public.

---

# 29. Secret Management

Secrets belong in a dedicated secret-management/environment system.

Examples:

```text
database credentials

production RPC credentials

session-signing secret

encryption keys

third-party service credentials
```

Requirements:

```text
not committed to git

not logged

not embedded in images

not returned by APIs

restricted by environment/service

rotatable
```

OWASP recommends centralizing and controlling secret storage, provisioning, rotation and auditing rather than hardcoding secrets.

---

# 30. `.env` Rule

Files such as:

```text
.env

.env.production

.env.local
```

containing secrets must not be committed.

Provide:

```text
.env.example
```

with placeholders only.

Example:

```text
DATABASE_URL=
NIMIQ_RPC_URL=
SESSION_SECRET=
```

not real credentials.

---

# 31. Object-Level Authorization

Every endpoint that accepts an object identifier must independently check authorization.

Examples:

```text
passId

purchaseId

providerId

packageId

redemptionId
```

Knowing an object's identifier must never imply permission.

OWASP identifies broken object-level authorization as a major API risk and recommends authorization checks on every function that accesses objects through user-controlled identifiers.

---

# 32. Pass Authorization

For private pass access:

```text
request pass P
      ↓
authenticate wallet/user
      ↓
load pass P
      ↓
verify actor owns P
      ↓
return allowed fields
```

Never:

```text
request pass P
      ↓
P exists
      ↓
return P
```

---

# 33. Provider Authorization

Provider-management operations require:

```text
authenticated identity
+
provider membership/ownership permission
```

Example:

```text
POST updatePackage(providerA, packageX)
```

must establish that the current actor may manage:

```text
providerA
```

and that:

```text
packageX belongs to providerA
```

---

# 34. Redemption Authorization

A redemption involves two distinct authorities:

```text
CUSTOMER AUTHORITY

owns the pass
and authorizes usage where required


PROVIDER AUTHORITY

is allowed to consume sessions
for that provider/pass
```

Both dimensions must be validated.

---

# 35. Cross-Provider Redemption Protection

Example attack:

```text
Provider B obtains QR
for Provider A's customer
```

Provider B must not be able to redeem it.

Backend must verify:

```text
redemption.pass.providerId
=
authenticatedProvider.id
```

before session consumption.

---

# 36. Customer Pass Ownership

For Nimpass MVP:

```text
verified purchase transaction sender
=
initial pass owner wallet
```

Returning access must prove the current authenticated wallet corresponds to:

```text
pass.ownerWallet
```

A URL, QR, screenshot or transaction hash is insufficient.

---

# 37. Pass IDs

Pass IDs should be:

```text
non-semantic

high entropy

non-sequential where practical
```

This reduces trivial enumeration.

However unpredictable IDs are only defense in depth.

Authorization checks are still mandatory.

---

# 38. API Response Minimization

APIs should return only required fields.

Customer pass response should not automatically expose:

```text
internal DB identifiers

security nonces

provider private metadata

raw payment-verification internals

internal fraud flags
```

Provider APIs should similarly avoid exposing unnecessary customer information.

OWASP recommends exposing only properties the caller is authorized to see rather than serializing whole internal objects.

---

# 39. Mass Assignment Protection

Never bind arbitrary client JSON directly onto sensitive domain objects.

Bad conceptual behavior:

```text
updatePass(req.body)
```

which could allow:

```text
remainingSessions = 999

status = ACTIVE

ownerWallet = attacker
```

Use explicit command DTOs/allowlists.

Example:

```text
UpdateProviderProfileInput {
    displayName
    description
}
```

not entire provider persistence model.

---

# 40. Customer Cannot Modify Session Balance

No normal customer endpoint may accept:

```text
remainingSessions

usedSessions

originalSessions
```

as writable values.

These are backend-derived state.

---

# 41. Provider Cannot Arbitrarily Modify Session Balance

Provider should also not receive:

```text
setRemainingSessions(500)
```

as a normal capability.

Session balances change through defined domain operations such as:

```text
successful redemption
```

If future manual adjustment exists, it requires a separate audited privileged workflow.

---

# 42. Redemption Security Model

A session redemption must satisfy all of:

```text
pass exists

pass active

remainingSessions > 0

provider matches pass

challenge valid

challenge unexpired

challenge unused

customer authorization valid where required

operation idempotent
```

Only then may:

```text
remainingSessions -= 1
```

---

# 43. Redemption Challenge

When the customer chooses:

```text
Use Session
```

the backend creates a unique:

```text
RedemptionChallenge
```

Conceptually:

```text
id

passId

providerId

ownerWallet

nonce

status

issuedAt

expiresAt
```

The challenge is temporary.

It is not the pass itself.

---

# 44. Redemption Challenge States

Conceptual lifecycle:

```text
CREATED
   ↓
PRESENTED
   ↓
VALIDATING
   ↓
AUTHORIZED
   ↓
CONSUMED
```

Alternative terminal states:

```text
EXPIRED

CANCELLED

REJECTED
```

A consumed challenge can never consume another session.

---

# 45. QR Contents

The QR should contain only what is necessary to locate/validate the temporary challenge.

Preferred:

```text
opaque redemption reference
```

Possible:

```text
short-lived signed reference
```

Avoid embedding:

```text
customer identity

wallet private information

pass history

session notes

provider private data

long-lived bearer secrets
```

---

# 46. QR Is Not a Credential of Permanent Ownership

Security assumption:

> **QR screenshots will happen.**

Therefore the system must remain safe if someone copies a QR.

A copied QR must not become a permanent session-spending credential.

---

# 47. QR Screenshot Protection

Controls include:

```text
short challenge lifetime

one-time use

server-side challenge state

provider binding

pass-state validation

wallet authorization where required

idempotency
```

The security architecture must assume attackers can perfectly copy the QR image.

---

# 48. QR Expiration

When:

```text
now > expiresAt
```

the challenge becomes:

```text
EXPIRED
```

and must not consume a session.

Generating another challenge does not reduce remaining sessions.

---

# 49. Multiple Active Challenges

Default security posture:

> Keep the number of simultaneously valid redemption challenges for one pass tightly controlled.

Recommended MVP:

```text
one active redemption challenge per pass
```

Creating a replacement challenge may invalidate the previous unused challenge.

This reduces screenshot/replay complexity.

---

# 50. Redemption Signature

Nimpass may require the pass owner to authorize a redemption through Nimiq Pay `sign()`.

Conceptual flow:

```text
challenge created
      ↓
customer signs redemption message
      ↓
provider presents/validates challenge
      ↓
backend verifies signature
      ↓
consume
```

This creates strong wallet-linked authorization beyond mere possession of a QR.

---

# 51. Redemption Signing Message

Conceptual message:

```text
Nimpass Session Redemption

Action: Redeem one session
Pass: <pass-public-reference>
Redemption: <redemption-id>
Provider: <provider-id>
Wallet: <owner-wallet>
Nonce: <nonce>
Expires At: <timestamp>
Origin: nimpass.example
```

The message must be deterministic.

The backend generates the authoritative fields.

---

# 52. Redemption Domain Separation

A redemption signature must not be valid for authentication.

Therefore:

```text
Action: Redeem one session
```

and:

```text
Action: Sign in to Nimpass
```

must use distinct messages/purpose values.

---

# 53. Replay Protection

A valid signed redemption must still be rejected when:

```text
challenge already consumed

challenge expired

pass already completed

provider does not match

session count changed incompatibly

redemption already resolved
```

Cryptographic validity alone is not enough.

---

# 54. Signature Replay Example

Attack:

```text
attacker captures:

signature S
for redemption R1
```

Then sends:

```text
S + R1
```

multiple times.

Expected:

```text
first valid request
→ 7 → 6

all repeats
→ existing success result

never
→ 6 → 5
```

---

# 55. Idempotent Redemption

Every redemption must have a stable identity.

Database/domain protection must ensure:

```text
redemptionId
→ maximum one session consumption
```

Frontend button disabling is not sufficient.

---

# 56. Atomic Redemption

Critical mutation must be atomic.

Conceptually:

```text
BEGIN

lock pass / enforce atomic update

verify redemption not consumed

verify pass ACTIVE

verify remainingSessions > 0

verify provider

verify authorization

decrement exactly one

mark redemption CONSUMED

create history event

COMMIT
```

Concurrent requests must not both pass the remaining-session check.

---

# 57. Race Condition Example

Suppose:

```text
remaining = 1
```

Two concurrent requests arrive.

Incorrect:

```text
Request A reads 1

Request B reads 1

A writes 0

B writes -1
```

Correct implementation guarantees:

```text
one request succeeds

one request receives completed/already-used state
```

and:

```text
remaining never < 0
```

---

# 58. Purchase Idempotency

The same economic principle applies to purchases.

One intended verified transaction must create:

```text
maximum one pass
```

Database protections should enforce uniqueness for:

```text
transactionHash

purchaseId
```

where appropriate.

---

# 59. Transaction Reuse Protection

A valid old transaction cannot settle a second purchase.

Backend must reject:

```text
txHash already linked to completed purchase
```

even when:

```text
amount matches

recipient matches
```

---

# 60. Payment Reference Security

Purchase references written into transaction data must be:

```text
opaque

non-sensitive

unguessability preferred

uniquely correlated
```

Never place personal information into on-chain transaction data.

---

# 61. Session Management

After wallet authentication, Nimpass may create an application session.

Sessions must be:

```text
server-verifiable

unpredictable

revocable

time-bounded

protected in transit
```

OWASP recommends high-entropy session identifiers whose meaning remains server-side rather than encoding sensitive data in the identifier itself.

---

# 62. Preferred Web Session Storage

For browser sessions, prefer secure HTTP-only cookies when architecture permits.

Security properties should include:

```text
Secure

HttpOnly

appropriate SameSite policy

Path=/

minimal Domain scope
```

Do not expose long-lived authentication tokens to arbitrary frontend JavaScript without a strong reason.

---

# 63. Session Fixation Protection

A new authenticated session should not simply reuse arbitrary pre-authentication session state supplied by the client.

After authentication:

```text
rotate/create authenticated session identity
```

according to the chosen session framework.

---

# 64. Session Expiration

Use:

```text
idle expiration

absolute expiration
```

appropriate to product risk.

Sensitive actions may require:

```text
fresh authentication
```

even during an existing long-lived session.

Example:

```text
change provider payout wallet
```

---

# 65. Logout

Logout must invalidate or revoke the application session as appropriate.

Removing UI state alone is insufficient.

---

# 66. Wallet Change

If wallet context changes:

```text
Wallet A
→
Wallet B
```

Nimpass must not continue exposing Wallet A's protected state.

Authorization-sensitive caches/state must be invalidated or re-evaluated.

---

# 67. Provider Role Authorization

Provider capabilities must use explicit role/policy checks.

Examples:

```text
create package

edit own package

view own provider passes

scan own customer redemption

change payout wallet
```

Do not implement:

```text
if authenticated
→ provider permissions
```

Authentication and authorization are separate.

---

# 68. Customer vs Provider Context

One wallet may potentially act as:

```text
customer

provider
```

Role context must not allow privilege confusion.

Example:

```text
customer permission
```

must not accidentally satisfy:

```text
provider-management permission
```

---

# 69. Administrative Privileges

If an admin role exists later, it must use:

```text
explicit minimal privileges

audited sensitive actions

no hidden universal client bypass
```

Do not create magic query parameters such as:

```text
?admin=true
```

or frontend-only role checks.

---

# 70. Rate Limiting

Endpoints must have resource-appropriate rate limits.

High-risk examples:

```text
auth challenge creation

signature verification

provider-wallet verification

purchase-intent creation

transaction verification

redemption generation

redemption validation

search/API endpoints
```

OWASP identifies unrestricted resource consumption as a common API risk and recommends operation-specific rate limits and payload limits.

---

# 71. Rate Limit Dimensions

Rate limiting may consider combinations of:

```text
IP

authenticated identity

wallet

provider

device signal where lawful/appropriate

endpoint

resource ID
```

Do not rely on IP alone for every threat.

---

# 72. Brute-Force Protection

Potential targets include:

```text
challenge endpoints

provider-wallet verification

pass enumeration

redemption guessing

admin authentication
```

Controls include:

```text
high-entropy identifiers

TTL

rate limits

lockouts/cooldowns where appropriate

monitoring
```

---

# 73. Denial-of-Service Protection

Apply explicit limits to:

```text
request body size

query length

pagination size

search complexity

batch request size

concurrent expensive operations

file uploads if introduced
```

Do not allow a client to request:

```text
limit = 10000000
```

or arbitrarily expensive nested queries.

---

# 74. GraphQL Security If Used

If Nimpass adopts GraphQL:

```text
authorization belongs in business/resolver layer

not frontend hiding
```

Also control:

```text
query depth

query complexity

batching

pagination bounds

introspection policy in production where appropriate
```

GraphQL must not bypass object-level authorization.

---

# 75. Input Validation

All untrusted input must be validated server-side.

Examples:

```text
provider names

package titles

descriptions

wallet addresses

IDs

session quantity

NIM price

URLs

search terms

redemption references
```

Validate:

```text
type

length

format

range

business constraints
```

---

# 76. Output Encoding and XSS

Provider-controlled text such as:

```text
provider description

package description

service name
```

is untrusted content.

It must never become executable HTML/JavaScript unless passed through a specifically designed, sanitized rich-text pipeline.

Default:

```text
render as text
```

---

# 77. Content Security Policy

Production Nimpass should use a restrictive Content Security Policy compatible with the application and Nimiq Pay host requirements.

CSP provides defense in depth against script injection, XSS and related browser attacks.

Avoid broad directives such as:

```text
script-src *
```

unless explicitly required and security-reviewed.

---

# 78. Security Headers

Production should intentionally configure headers/policies such as:

```text
Content-Security-Policy

X-Content-Type-Options

Referrer-Policy

Permissions-Policy
```

and relevant framing controls compatible with the Mini App/WebView architecture.

Do not blindly apply:

```text
frame-ancestors 'none'
```

if Nimiq Pay legitimately needs to embed/load the application.

Security headers must reflect the actual hosting model.

---

# 79. HTTPS

Production Nimpass must use HTTPS.

Never send:

```text
authentication sessions

wallet-linked private app data

purchase state

redemption state
```

over unencrypted public HTTP.

Local LAN development is a separate controlled environment.

---

# 80. CORS

Backend CORS policy should allow only intended origins.

Avoid production:

```text
Access-Control-Allow-Origin: *
```

for authenticated/private APIs unless that exposure is deliberately safe.

Credentials plus permissive origins are especially dangerous.

---

# 81. CSRF

If browser authentication uses cookies, state-changing endpoints require CSRF consideration.

Controls may include:

```text
SameSite cookies

CSRF tokens where required

Origin/Referer validation

appropriate HTTP methods
```

SameSite should be treated as defense in depth, not universal CSRF elimination.

---

# 82. SSRF

If Nimpass later fetches provider-supplied URLs or remote images server-side:

```text
never blindly fetch arbitrary URLs
```

Prevent access to:

```text
localhost

private networks

cloud metadata endpoints

internal services
```

Prefer managed media upload/storage over arbitrary server-side URL fetching where practical.

---

# 83. File Upload Security

If provider image upload is supported:

```text
validate content type

validate actual file content

limit file size

generate safe storage names

do not execute uploads

serve from controlled media storage
```

Never trust filename extension alone.

---

# 84. Database Security

Database credentials must be backend-only.

Application DB access should use:

```text
least privilege

parameterized queries / safe ORM/query APIs

restricted network access

backups

encryption where infrastructure supports it
```

No database should be directly reachable from the browser.

---

# 85. Sensitive Data at Rest

Security-sensitive records may include:

```text
sessions

security challenges

wallet mappings

fraud/security metadata

provider private settings
```

Use infrastructure-level encryption at rest where available.

Particularly sensitive application values requiring secrecy should use application-level protection where justified.

---

# 86. Password Storage

If password-based authentication is ever introduced:

```text
never store plaintext passwords
```

Use a modern password hashing algorithm with proper parameters.

However wallet-native authentication remains the preferred identity direction for wallet ownership flows.

---

# 87. Logging

Security logging should record important events without storing secrets.

Useful events include:

```text
authentication success/failure

provider-wallet verification

payout-wallet changes

purchase-intent creation

payment verification failures

transaction reuse attempts

redemption creation

redemption rejection

duplicate redemption attempts

authorization failures

rate-limit events
```

---

# 88. Never Log

Do not log:

```text
private keys

seed phrases

session secrets

full authentication cookies

server signing secrets

database passwords

third-party credentials
```

Signed security payloads and wallet addresses should be logged only according to operational/privacy need.

---

# 89. Privacy and Competition Rules

Competition rules explicitly prohibit collection, storage or transmission of user data without clear disclosure, lawful basis and informed user consent. They also prohibit phishing, deceptive or fraudulent functionality, malware, spyware and hidden malicious behavior.

Nimpass must maintain transparent data practices.

---

# 90. Data Minimization

Collect only data necessary for the product.

Potentially necessary:

```text
wallet address

provider public profile

provider payout-wallet mapping

package data

purchase state

pass ownership

redemption history
```

Question before collecting:

```text
Do we need this?

Why?

For how long?

Who can see it?
```

---

# 91. Public vs Private Data

## Public

Potential examples:

```text
provider display name

public description

public services

published packages

NIM package price
```

## Private

Potential examples:

```text
customer pass

wallet-linked service relationship

purchase history

redemption history

security challenges

provider security settings
```

Public status must be explicit in the data model.

---

# 92. Provider Customer Visibility

Providers may need access to information necessary to deliver purchased services.

They should not automatically gain broad access to:

```text
customer wallet portfolio

other providers used

other customer passes

unrelated transaction history
```

Authorization should expose only the provider's own relevant service relationship.

---

# 93. On-Chain Privacy

Nimiq transactions are blockchain transactions.

Do not write personally identifying application data into transaction data.

Use:

```text
opaque purchase reference
```

instead.

Blockchain data should be treated as potentially permanently observable.

---

# 94. Error Messages

Security errors must balance clarity with information disclosure.

Good:

```text
You don't have access to this pass.
```

Avoid:

```text
Pass belongs to wallet NQ....
Provider ID is ....
Internal policy check failed at ....
```

unless such information is intentionally safe.

---

# 95. Authentication Errors

Avoid revealing unnecessary account state distinctions that aid enumeration.

Example:

```text
Wallet authentication failed.
```

may be safer than exposing sensitive internal reasons.

Operational logs may preserve detailed error codes.

---

# 96. Payment Errors

Do not falsely claim:

```text
no payment occurred
```

when payment state is uncertain.

Security includes preventing users from accidentally paying twice.

Use:

```text
We're still checking your payment.
Do not send another payment yet.
```

when appropriate.

---

# 97. Dependency Security

Dependencies must be:

```text
necessary

maintained

reviewed

version-controlled
```

Regularly inspect:

```text
npm dependencies

Go dependencies

Nimiq SDK versions

cryptographic libraries
```

Do not install random wallet/crypto libraries to solve functionality already provided by official Nimiq packages.

---

# 98. Supply-Chain Security

Because wallet/payment software is security-sensitive:

```text
review dependency additions

commit lockfiles

avoid untrusted install scripts where possible

monitor known vulnerabilities

remove abandoned packages
```

Prefer official Nimiq packages for Nimiq functionality.

---

# 99. CI Security

CI/CD must never expose production secrets to:

```text
untrusted pull requests

public logs

build artifacts

frontend bundles
```

Production deployment credentials should use the CI provider's secret system and least privilege.

---

# 100. Branch and Review Protection

For security-critical code such as:

```text
payment verification

wallet authentication

payout-wallet management

redemption

authorization
```

changes should receive deliberate review before production.

Where available, require protected production branches.

---

# 101. Testnet/Mainnet Isolation

Security boundaries must distinguish:

```text
TESTNET

MAINNET
```

A testnet transaction must never create a mainnet production pass.

Production data should record expected network explicitly.

---

# 102. Development Backdoors

Forbidden:

```text
if DEV_USER then authenticated

?skipWallet=true

?paymentSuccess=true

hardcoded admin wallet

universal redemption code
```

Test helpers must not survive into production paths.

Mock providers must be impossible to accidentally activate in production.

---

# 103. Demo Security

Competition demos must use the real supported architecture.

Do not ship a hidden path that:

```text
bypasses payment

creates passes freely

skips wallet ownership

ignores redemption authorization
```

simply to make judging easier.

---

# 104. Security Monitoring

Monitor abnormal patterns such as:

```text
many failed signatures

many auth challenges

many purchase intents without payment

reused transaction hashes

rapid redemption challenges

multiple invalid QR attempts

cross-provider access failures

rate-limit spikes
```

Monitoring should support investigation without collecting unnecessary data.

---

# 105. Fraud Signals

Potential fraud/security signals may include:

```text
transaction reuse

rapid wallet switching

many redemption attempts

repeated expired challenges

many provider payout changes

unusual request volume
```

Signals should inform:

```text
risk decisions

rate limiting

manual review
```

not silently become an opaque permanent user punishment system without policy.

---

# 106. Security Audit Events

High-value immutable/auditable events should include:

```text
provider wallet verified

provider wallet changed

package payment confirmed

pass created

session redeemed

pass completed

authorization denied for sensitive action
```

Operational audit information is distinct from customer-visible history.

---

# 107. Incident Response

Security incidents may include:

```text
secret leak

payment verification bug

unauthorized pass access

duplicate redemption bug

provider account compromise

production dependency compromise
```

Minimum response process:

```text
identify

contain

preserve evidence

rotate credentials where applicable

patch root cause

assess affected users/transactions

communicate appropriately

verify recovery
```

---

# 108. Secret Leak Response

If a secret enters git history:

```text
deleting the current file
```

is insufficient.

Treat secret as compromised.

Required:

```text
revoke/rotate secret

remove exposure

inspect logs/use

update deployment

consider repository-history cleanup where appropriate
```

---

# 109. Payout-Wallet Compromise

If provider payout credentials/security are suspected compromised:

```text
freeze new purchase intents for affected provider
```

may be necessary until ownership is re-established.

Do not alter already confirmed blockchain transaction history.

---

# 110. Redemption Vulnerability Response

If duplicate session consumption becomes possible:

priority is:

```text
prevent additional incorrect redemptions
```

before adding unrelated product features.

Economic integrity bugs are release blockers.

---

# 111. Security Testing — Authentication

Tests must include:

```text
valid wallet signature

wrong signer

wrong wallet

expired challenge

consumed challenge

modified message

reused signature

wrong purpose

invalid signature

wallet cancellation
```

---

# 112. Security Testing — Authorization

Tests must include:

```text
Customer A requests Customer B pass

Provider A requests Provider B package management

Provider A attempts Provider B redemption

unauthenticated access to private pass

customer attempts provider operation

provider attempts unauthorized customer resource
```

Every case must fail safely.

---

# 113. Security Testing — Purchase

Tests must include:

```text
wrong amount

wrong recipient

wrong network

wrong payment reference

reused transaction

pending transaction

nonexistent transaction

RPC outage

duplicate completion requests

concurrent completion
```

---

# 114. Security Testing — Redemption

Tests must include:

```text
expired QR

QR reused

QR screenshot/replay

wrong provider

wrong customer wallet

zero remaining sessions

two simultaneous redemption requests

modified redemption ID

modified pass ID

valid signature for wrong challenge

old signature replay
```

---

# 115. Security Testing — API

Tests must include:

```text
object ID manipulation

missing authorization

unexpected fields

oversized payloads

invalid pagination

rapid requests

invalid wallet-address format

malformed identifiers

unexpected HTTP methods
```

---

# 116. Security Testing — Browser

Test:

```text
XSS through provider name

XSS through package description

malicious URL fields

CSP behavior

cookie flags

CORS

CSRF-sensitive mutations

wallet state after tab changes

private state after logout
```

---

# 117. Multiple Tabs

Tab A and Tab B may display stale state.

Security-sensitive operations must re-read authoritative state.

Example:

```text
Tab A:
redeems 7 → 6

Tab B:
still visually says 7
```

Tab B's next redemption request must validate server state and operate from:

```text
6
```

not stale local state.

---

# 118. Cache Security

Do not store protected user data in publicly cacheable responses.

Authenticated/private API responses should have appropriate cache policies.

Wallet A's pass data must never be served from a shared cache to Wallet B.

---

# 119. Browser History

Avoid putting sensitive secrets in URLs because URLs may appear in:

```text
browser history

logs

analytics

referrer headers

screenshots
```

Do not place:

```text
auth token

raw signature

private challenge secret
```

in query parameters.

---

# 120. Analytics

If analytics are introduced:

```text
do not send private pass data

do not send signatures

do not send secrets

do not send unnecessary wallet identifiers
```

Analytics vendors must not become an accidental customer-data leak.

---

# 121. Third-Party Scripts

Keep third-party browser scripts minimal.

Every external script runs with significant visibility into frontend activity.

Avoid unnecessary:

```text
trackers

chat widgets

ad scripts

unknown SDKs
```

especially around wallet/payment screens.

---

# 122. Dependency on Nimiq Availability

Nimiq Pay/provider failure should degrade safely.

Public Nimpass browsing may remain functional.

Wallet-required actions should clearly stop rather than using insecure fallback payment logic.

Never fallback from:

```text
secure wallet payment
```

to:

```text
enter private key manually
```

---

# 123. Provider Error Normalization

Wallet-provider exceptions must be mapped to safe application states.

Example:

```text
PermissionDeniedError
→ USER_CANCELLED
```

not raw internal stack trace.

Nimiq documents user rejection as a normal provider-error case that applications should handle gracefully.

---

# 124. Fail Closed for Authorization

If authorization state cannot be established:

```text
deny protected action
```

rather than:

```text
assume allowed
```

Examples:

```text
cannot verify wallet

cannot load provider membership

cannot validate challenge
```

must not silently grant access.

---

# 125. Fail Carefully for Payment

Payment differs slightly because funds may already have moved.

If transaction verification infrastructure is temporarily unavailable:

```text
VERIFICATION_DELAYED
```

is safer than:

```text
FAILED
```

This prevents duplicate payment.

So:

```text
authorization uncertainty
→ fail closed

payment-settlement uncertainty
→ preserve/reconcile
```

---

# 126. Security UX Principle

Security should be strong without making every action frightening.

Users should understand meaningful actions.

Examples:

```text
Pay 250 NIM

Use one session

Verify payout wallet
```

Avoid unnecessary technical language such as:

```text
Ed25519 cryptographic authorization required.
```

---

# 127. Wallet Signature UX

Before a signature prompt, explain why.

Example:

```text
Confirm that this wallet owns the pass.
```

or:

```text
Authorize the use of one session.
```

Avoid:

```text
Sign this message.
```

with no purpose.

---

# 128. No Deceptive Wallet UX

The competition explicitly prohibits deceptive, scammy or fraudulent functionality and phishing.

Nimpass must never:

```text
imitate Nimiq Pay credential screens

ask for seed phrases

misrepresent payment recipient

hide the amount

claim payment failed when known successful

silently change package terms during checkout
```

---

# 129. Legal/Privacy Boundary

Security documentation does not itself establish compliance with every jurisdiction.

However architecture must support:

```text
data minimization

transparent disclosure

user-consent requirements where applicable

secure deletion/retention policies
```

Competition rules make builders responsible for legal compliance and application security.

---

# 130. Security Priority Levels

## P0 — Release Blocker

```text
private-key isolation

server-side payment verification

wallet authentication

object-level authorization

provider authorization

verified payout wallet

pass ownership

replay-safe redemption

idempotent purchase

idempotent redemption

secrets protected

testnet/mainnet isolation
```

## P1 — Required Production Hardening

```text
rate limiting

security headers

CORS

CSRF controls where relevant

structured security logging

dependency scanning

incident procedures

CSP

privacy minimization
```

## P2 — Advanced

```text
advanced fraud scoring

security notifications

device-risk scoring

automated anomaly detection

advanced provider step-up authentication
```

P2 must not delay or destabilize P0.

---

# 131. Security Invariants

The following must always remain true:

1. Nimpass never receives a Nimiq private key.

2. Nimpass never requests a seed phrase.

3. Wallet address knowledge alone does not prove wallet control.

4. Device identifier is never treated as user authentication.

5. Authentication challenges are server-generated.

6. Authentication challenges expire.

7. Authentication challenges are one-time-use.

8. Signature purpose is domain-separated.

9. Signer public key must correspond to the expected wallet.

10. Provider payout wallets must be verified.

11. Client cannot select authoritative payment recipient.

12. Client cannot select authoritative payment amount.

13. Transaction hash alone cannot create a pass.

14. Backend verifies every payment.

15. One transaction cannot create multiple passes.

16. One completed purchase creates at most one pass.

17. Pass URLs do not establish ownership.

18. Object IDs never replace authorization.

19. Customers cannot directly edit session balances.

20. Providers cannot arbitrarily edit session balances.

21. QR possession is not permanent ownership proof.

22. Redemption challenges expire.

23. Redemption challenges are one-time-use.

24. A successful redemption consumes exactly one session.

25. One redemption can never consume two sessions.

26. Remaining sessions never become negative.

27. A completed pass cannot be normally redeemed.

28. Cross-provider redemption is forbidden.

29. Client state is never authoritative for economic state.

30. Secrets never enter the public frontend bundle.

31. Secrets never enter git intentionally.

32. Testnet activity never settles mainnet purchases.

33. Authorization uncertainty fails closed.

34. Payment uncertainty enters reconciliation rather than encouraging another payment.

35. Sensitive operations produce auditable security events.

---

# 132. AI Coding Agent Security Rules

Before implementing a sensitive endpoint, an AI agent must answer:

```text
Who is the actor?

How is the actor authenticated?

What object is being accessed?

Why may this actor access it?

What values come from the client?

Which values are authoritative server-side?

Can this request be replayed?

Can it run twice concurrently?

What happens if the network fails?

What is logged?

What secret/data could leak?

What database constraint protects the invariant?
```

If these questions cannot be answered, the sensitive flow is not ready for implementation.

---

# 133. AI Agent — Never Trust IDs

Forbidden pattern:

```text
getPass(passId)
```

without:

```text
authorize(actor, pass)
```

Correct conceptual pattern:

```text
pass = load(passId)

requireCanViewPass(actor, pass)

return safePassView(pass)
```

---

# 134. AI Agent — Never Trust Frontend Roles

Forbidden:

```text
if (localStorage.role === "provider")
```

for backend security.

The backend determines provider authority.

---

# 135. AI Agent — Never Hand-Roll Cryptography

Do not implement:

```text
custom signature algorithm

custom crypto hash construction without protocol requirement

custom key parser
```

when maintained Nimiq/security libraries exist.

Cryptographic code requires exact compatibility with the provider's documented signing semantics.

---

# 136. AI Agent — Never Disable Security for UX

Do not solve a user-flow inconvenience by removing:

```text
wallet verification

server authorization

payment verification

replay protection
```

Improve the UX around the security boundary instead.

---

# 137. AI Agent — Database Constraints Matter

Important invariants should be protected at multiple layers.

Examples:

```text
transaction_hash UNIQUE

purchase_id UNIQUE for pass relation

redemption_id UNIQUE

remaining_sessions >= 0
```

where supported by the chosen database/schema.

Do not rely only on frontend button state.

---

# 138. Canonical Security Scenario — Purchase

```text
Alex creates a package.

Alex's payout wallet has already been verified.

Emin presses Buy Pass.

Backend loads the package.

Backend determines:

price
recipient
sessions

Frontend cannot override them.

Nimiq Pay displays native payment approval.

Emin pays.

Frontend receives transaction hash.

No pass exists yet.

Backend reads transaction from Nimiq network.

Backend verifies:

correct network
correct recipient
correct amount
correct purchase reference
acceptable transaction state
transaction unused

Backend derives sender wallet.

Exactly one pass is atomically created.

The sender wallet becomes pass owner.

Submitting the same transaction again does not create another pass.
```

---

# 139. Canonical Security Scenario — Authentication

```text
Emin chooses My Passes.

Nimpass needs wallet authentication.

Nimiq Pay provides/selects Emin's wallet address.

Backend creates random one-time challenge.

Challenge is bound to:

Nimpass
wallet
purpose
nonce
expiration.

Emin signs through Nimiq Pay.

Backend receives:

public key
signature.

Backend verifies the exact challenge.

Backend derives/checks wallet address.

Challenge is consumed.

Nimpass creates application session.

My Passes may now return only passes owned by that wallet.
```

---

# 140. Canonical Security Scenario — Redemption

```text
Emin owns a pass.

7 sessions remain.

Emin chooses Use Session.

Backend creates redemption R1.

R1 is:

short-lived
one-time
bound to pass
bound to provider
bound to owner wallet.

Emin authorizes R1 where required.

QR presents R1.

Alex scans it.

Alex is authenticated as the provider.

Backend verifies:

Alex owns/manages the provider
pass belongs to Alex's provider
Emin owns pass
R1 is valid
R1 is not expired
R1 is unused
signature is valid
remaining sessions = 7
pass is ACTIVE.

Inside an atomic operation:

R1 becomes CONSUMED.

Pass becomes:

6 remaining.

History event is created.

If Alex scans the same QR again:

backend recognizes R1.

It returns the original success/current state.

It does not produce:

6 → 5.
```

---

# 141. Threat Matrix

| Threat                                        | Required defense                               |
| --------------------------------------------- | ---------------------------------------------- |
| Attacker guesses pass ID                      | Object-level authorization                     |
| Attacker copies QR screenshot                 | TTL + one-time challenge + server validation   |
| QR scanned twice                              | Redemption idempotency                         |
| Two scans arrive simultaneously               | Atomic transaction/concurrency protection      |
| Customer changes price in DevTools            | Server-side package snapshot                   |
| Customer changes recipient                    | Server-side verified payout address            |
| Old tx reused                                 | Unique transaction hash + purchase correlation |
| Fake payment success                          | Blockchain verification                        |
| Attacker claims victim wallet                 | Signature + public-key/address validation      |
| Login signature reused                        | Nonce + TTL + one-time challenge               |
| Redemption signature reused                   | Redemption nonce + one-time consumption        |
| Provider redeems competitor's pass            | Provider-object authorization                  |
| User accesses another pass URL                | Ownership authorization                        |
| Secret exposed in frontend                    | Server-side secret storage                     |
| Flood purchase intents                        | Rate limiting                                  |
| Flood redemption challenges                   | Rate limiting + active-challenge controls      |
| XSS in provider description                   | Output encoding + CSP                          |
| Stolen provider session changes payout wallet | Fresh proof/step-up + audit                    |
| RPC temporarily fails                         | Verification delayed/reconciliation            |
| Testnet tx submitted to production            | Explicit network validation                    |

---

# 142. Production Security Gate

Nimpass must not be considered production-ready until:

```text
wallet auth tests pass

provider payout verification works

purchase verification works

transaction reuse blocked

BOLA tests pass

cross-provider access blocked

QR replay blocked

concurrent redemption safe

negative session balance impossible

secrets removed from repo

CORS configured

session cookies hardened

rate limits active

CSP/security headers reviewed

logs contain no secrets

testnet/mainnet separated

production dependency audit performed

real Nimiq Pay security flows tested
```

---

# 143. Competition Security Gate

Before competition submission:

```text
No seed phrase/private-key collection
✓

No fake wallet UI
✓

No hidden data collection
✓

Privacy behavior disclosed
✓

No hardcoded secrets
✓

Real payment verification
✓

Unauthorized pass access tested
✓

Duplicate redemption tested
✓

Public repository reviewed for secrets
✓

Production endpoints rate limited
✓

No malicious/debug backdoors
✓
```

The competition rules make builders responsible for the security and legal compliance of submitted Mini Apps and explicitly disallow phishing, malware, spyware, deceptive UX and undisclosed user-data practices.

---

# 144. Security Source Hierarchy

When security implementation details conflict:

```text
1. Current official Nimiq documentation

2. This Nimpass security architecture

3. Nimpass architecture/payment documents

4. Maintained OWASP guidance

5. Framework documentation

6. Generated AI suggestions
```

AI-generated code never overrides an explicit security invariant.

---

# 145. External Platform Facts vs Nimpass Decisions

## Official Nimiq facts

Current documentation establishes that:

```text
Mini Apps run in a wallet-mediated environment.

Private keys are not exposed directly.

Sensitive wallet operations require approval.

listAccounts() exists.

sign() exists.

sign() returns public key + signature.

NIM payment APIs exist.

Device identifier is not user identity.
```

## Nimpass architectural decisions

Nimpass additionally requires:

```text
challenge-based wallet auth

verified provider payout wallets

server-side payment verification

wallet-linked pass authorization

short-lived redemption challenges

domain-separated signatures

QR replay resistance

atomic session consumption

idempotent purchases/redemptions
```

These are our product security rules built on top of the Nimiq primitives.

---

# 146. Relationship to Other Documents

```text
01-PRODUCT.md
→ What requires protection


02-USER-FLOWS.md
→ What users experience


04-NIMIQ-MINI-APPS.md
→ Nimiq Pay / Mini App environment


05-NIMIQ-PAY-INTEGRATION.md
→ Payment protocol and reconciliation


08-ARCHITECTURE.md
→ Concrete services, database,
  infrastructure and APIs


09-SECURITY.md
→ Trust boundaries, authentication,
  authorization and abuse resistance


10-SUBMISSION-CHECKLIST.md
→ Final production/competition gate
```

---

# 147. Source-of-Truth Rule

When implementation weakens a security rule because:

```text
it is easier

the UI already hides the button

the ID is difficult to guess

the request normally only happens once

the wallet already showed a confirmation

the frontend already validated it
```

the implementation is wrong.

Security must hold even when the attacker:

```text
reads the public source code

uses DevTools

constructs API requests manually

copies URLs

copies QR codes

replays requests

runs requests concurrently

changes frontend JavaScript

controls their own wallet
```

---

# 148. Final Security Principle

The simplest security model for Nimpass is:

```text
Nimiq Pay
proves wallet-mediated actions.

The blockchain
proves transaction facts.

Nimpass authentication
proves the current application identity.

Nimpass authorization
proves whether that identity may access an object.

Nimpass domain logic
proves whether the requested state transition is legal.

The database
preserves the invariant atomically.
```

None of these layers replaces all the others.

Therefore:

```text
WALLET SIGNATURE
≠
AUTOMATIC AUTHORIZATION

QR CODE
≠
PASS OWNERSHIP

TRANSACTION HASH
≠
VALID PURCHASE

OBJECT ID
≠
ACCESS

FRONTEND SUCCESS
≠
SERVER SUCCESS
```

The actual model is:

```text
AUTHENTICATED ACTOR
+
AUTHORIZED OBJECT ACCESS
+
VALID DOMAIN STATE
+
CRYPTOGRAPHIC PROOF WHERE REQUIRED
+
SERVER-SIDE VERIFICATION
+
REPLAY PROTECTION
+
ATOMIC / IDEMPOTENT MUTATION
=
TRUSTED NIMPASS ACTION
```

The customer-facing product should still remain simple:

```text
Pay.

Own your pass.

Use one session.

See exactly what remains.
```

All of the security complexity exists behind that experience so the user can trust it.
