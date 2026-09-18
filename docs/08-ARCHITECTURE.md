# Nimpass — Technical Architecture

> **Document type:** Technical architecture source of truth
> **Project:** Nimpass
> **Status:** Active
> **Architecture style:** Web-first modular monolith
> **API style:** REST
> **Primary backend language:** Go
> **Primary database:** PostgreSQL
> **Primary frontend:** React + Vite + TypeScript
> **Audience:** Developers, AI coding agents, reviewers, maintainers
> **Depends on:** `01-PRODUCT.md`, `02-USER-FLOWS.md`, `03-DESIGN-SYSTEM.md`, `04-NIMIQ-MINI-APPS.md`, `05-NIMIQ-PAY-INTEGRATION.md`, `06-COMPETITION.md`
> **Primary purpose:** Define how Nimpass is technically structured, where responsibilities live, how components communicate, and which architectural decisions are binding.

---

# 1. Architecture Goal

Nimpass should use the simplest architecture capable of reliably supporting the full product lifecycle:

```text
Provider
   ↓
Creates Service
   ↓
Creates Pass
   ↓
Publishes Pass

Customer
   ↓
Views Pass
   ↓
Pays with NIM
   ↓
Owns Pass
   ↓
Returns Later
   ↓
Redeems Session
   ↓
Remaining Sessions Decrease
   ↓
Pass Completes
```

The architecture must prioritize:

* correctness,
* reliability,
* security,
* maintainability,
* fast development,
* competition readiness,
* clear domain boundaries.

It must not optimize prematurely for extreme scale.

---

# 2. Core Architecture Principle

Nimpass should be implemented as:

```text
WEB FRONTEND
     ↓
REST API
     ↓
GO MODULAR MONOLITH
     ↓
POSTGRESQL
```

with:

```text
NIMIQ PAY
```

acting as the wallet and payment environment.

Optional supporting infrastructure may include:

```text
Redis
```

for carefully selected transient workloads.

---

# 3. High-Level Architecture

```text
┌───────────────────────────────────────────────┐
│                 USER ENVIRONMENT              │
│                                               │
│ Desktop Browser                              │
│ Laptop Browser                               │
│ Tablet                                       │
│ Mobile Browser                               │
│ Nimiq Pay Mini App WebView                   │
└────────────────────────┬──────────────────────┘
                         │
                         ▼
┌───────────────────────────────────────────────┐
│                  FRONTEND                     │
│                                               │
│ React                                         │
│ TypeScript                                    │
│ Vite                                          │
│ Tailwind CSS                                  │
│ shadcn/ui                                     │
│ Lucide Icons                                  │
│                                               │
│ Public Experience                             │
│ Customer Experience                           │
│ Provider Workspace                            │
│ Nimiq Integration Adapter                     │
└───────────────┬───────────────────┬───────────┘
                │                   │
                │ HTTPS / REST      │
                ▼                   ▼
┌──────────────────────────┐   ┌──────────────────────┐
│       NIMPASS API        │   │      NIMIQ PAY       │
│                          │   │                      │
│ Go                       │   │ Injected Provider    │
│ Chi Router               │   │ Wallet               │
│ Application Layer        │   │ Native Approval      │
│ Domain Layer             │   │ Signing              │
│ Infrastructure Layer     │   │ NIM Payment          │
└────────────┬─────────────┘   └──────────────────────┘
             │
             ▼
┌───────────────────────────────────────────────┐
│                  DATA LAYER                   │
│                                               │
│ PostgreSQL                                    │
│                                               │
│ Optional Redis                                │
└───────────────────────────────────────────────┘
```

---

# 4. Architecture Style

Nimpass uses a:

> **Modular Monolith**

for the competition version.

This means:

```text
One backend application
+
clear internal modules
+
one primary relational database
```

rather than:

```text
many microservices
+
distributed messaging
+
multiple independently deployed domains
```

---

# 5. Why Modular Monolith

Nimpass currently does not need microservices.

A modular monolith provides:

* simpler deployment,
* fewer network boundaries,
* easier transactions,
* easier debugging,
* easier local development,
* faster competition development,
* fewer failure modes.

Domain separation still exists inside the application.

---

# 6. No Premature Microservices

Do NOT create separate services such as:

```text
payment-service

pass-service

provider-service

redemption-service

notification-service
```

for the MVP.

These concepts should initially exist as modules inside the Go backend.

Service extraction may be considered later if real operational needs justify it.

---

# 7. Selected Technology Stack

## Frontend

```text
React
TypeScript
Vite
Tailwind CSS
shadcn/ui
Lucide Icons
@nimiq/mini-app-sdk   (wallet inside Nimiq Pay)
@nimiq/hub-api        (wallet in an ordinary browser)
```

---

## Backend

```text
Go
Chi Router
REST API
Clean / Hexagonal-inspired structure
```

---

## Persistence

```text
PostgreSQL
```

---

## Optional transient infrastructure

```text
Redis
```

---

## Deployment

```text
Frontend:
Vercel

Backend:
Container-capable Go hosting

Database:
Managed PostgreSQL

Redis:
Managed Redis only if required
```

---

# 8. GraphQL Decision

Nimpass will NOT use GraphQL for the competition MVP.

The selected API style is:

```text
REST
```

through the Go `chi` router.

Do not introduce:

* gqlgen,
* GraphQL schema,
* GraphQL resolvers,
* GraphQL client libraries,

unless this architecture decision is explicitly changed later.

---

# 9. Why REST

Nimpass's API is naturally resource-oriented.

Core resources include:

```text
providers

services

Passes

passes

purchases

redemptions

activity/history
```

The client does not currently require the level of flexible graph querying that would justify GraphQL.

REST provides:

* simpler API implementation,
* simpler debugging,
* simpler caching,
* easier competition development,
* fewer dependencies,
* easier network inspection.

---

# 10. Frontend Philosophy

The frontend owns:

```text
presentation

interaction

routing

responsive behavior

local UI state

forms

Nimiq Pay provider interaction

API consumption
```

The frontend does NOT own authoritative business state.

---

# 11. Frontend Must Not Be the Authority

The frontend must never be authoritative for:

```text
payment success

pass ownership

remaining session balance

redemption success

Pass historical terms

pass completion
```

These must ultimately be backed by authoritative server state.

---

# 12. Browser Runtime Model

Nimpass can run in two broad runtime contexts.

## Standard Web Browser

Used for:

* public discovery,
* provider pages,
* Pass pages,
* provider administration,
* browsing owned state where authenticated appropriately.

## Nimiq Pay Mini App Environment

Used when Nimiq wallet functionality is required.

Examples:

* account access,
* signing,
* NIM payment,
* wallet-authorized operations.

---

# 13. Web-First Runtime Rule

Nimpass must not assume:

```text
window.NimiqProviderAlwaysExists = true
```

Normal web browsers may not contain the Nimiq Pay injected provider.

The frontend must therefore detect capability.

Conceptually:

```text
Web Browser
    ↓
No Nimiq provider
    ↓
Public Nimpass still works
```

while:

```text
Nimiq Pay WebView
    ↓
Nimiq provider available
    ↓
Wallet functionality enabled
```

---

# 14. Never Fake the Provider

Do not create a production provider shim that pretends Nimiq Pay exists when it does not.

Do not expose fake production wallet state.

Development mocks may exist for automated testing, but they must be:

* isolated,
* clearly marked,
* impossible to confuse with production behavior.

---

# 15. Wallet-Required Actions

Actions requiring Nimiq wallet capabilities must pass through the dedicated Nimiq integration layer.

Examples:

```text
Request Wallet Identity

Pay with NIM

Sign Authorization Challenge
```

UI components should not scatter direct provider calls throughout the application.

---

# 16. Frontend Nimiq Adapter

Create a dedicated frontend boundary conceptually similar to:

```text
src/
└── lib/
    └── nimiq/
        ├── transport.ts          the WalletTransport interface
        ├── mini-app-transport.ts Nimiq Pay implementation
        ├── hub-transport.ts      Nimiq Hub implementation
        ├── wallet-runtime.ts     runtime selection
        ├── client.ts             Mini App SDK access
        ├── hub-endpoint.ts
        └── errors.ts
```

Exact filenames may evolve.

The architectural boundary must remain.

Runtime selection lives at this boundary and nowhere else. Application code consumes capabilities — connect, sign a challenge, pay, current wallet, availability — and never branches on which wallet answered (§15, §86).

---

# 17. Why the Nimiq Adapter Exists

Without a dedicated boundary, code may evolve into:

```text
Component A
→ calls Nimiq directly

Component B
→ initializes provider again

Component C
→ interprets error differently

Component D
→ implements payment another way
```

This creates inconsistency.

Instead:

```text
UI
 ↓
Wallet abstraction (WalletTransport)
 ↓
 ├── Nimiq Pay Adapter ── @nimiq/mini-app-sdk ── Nimiq Pay
 │
 └── Nimiq Hub Adapter ── @nimiq/hub-api ────── Nimiq Hub
```

---

# 18. Nimiq Initialization

Inside the supported Nimiq Pay environment, Nimiq provider access should use the official Mini App SDK initialization mechanism.

Conceptually:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
```

Do not assume provider readiness synchronously.

Do not create undocumented provider initialization methods.

---

# 19. Private Key Boundary

Nimpass must never receive:

```text
private key

seed phrase

wallet secret
```

Nimpass must never ask the user for these values.

Wallet cryptographic operations remain inside Nimiq Pay.

---

# 20. Sensitive Wallet Actions

Sensitive actions should follow:

```text
Nimpass UI
    ↓
Nimiq SDK / Provider
    ↓
Nimiq Pay Native Confirmation
    ↓
User Approval
    ↓
Operation
```

Nimpass must not attempt to bypass native confirmations.

---

# 21. Backend Responsibility

The Go backend owns authoritative business logic.

Responsibilities include:

```text
provider management

service management

Pass management

pass lifecycle

purchase reconciliation

ownership records

redemption validation

session balance

history

idempotency

authorization

audit-relevant events
```

---

# 22. Backend Does Not Hold Wallet Secrets

The backend may store public wallet addresses and verification information where necessary.

It must never store:

```text
wallet private keys

seed phrases

private signing material
```

belonging to users.

---

# 23. Backend Structure

Recommended conceptual structure:

```text
backend/
├── cmd/
│   └── server/
│
├── internal/
│   ├── domain/
│   │   ├── provider/
│   │   ├── service/
│   │   ├── Pass/
│   │   ├── pass/
│   │   ├── purchase/
│   │   └── redemption/
│   │
│   ├── application/
│   │   ├── provider/
│   │   ├── service/
│   │   ├── Pass/
│   │   ├── pass/
│   │   ├── purchase/
│   │   └── redemption/
│   │
│   ├── infrastructure/
│   │   ├── postgres/
│   │   ├── redis/
│   │   ├── nimiq/
│   │   └── observability/
│   │
│   └── interfaces/
│       └── http/
│
├── migrations/
└── tests/
```

Exact folders may adapt to the existing backend foundation.

The layering concept is more important than exact names.

---

# 24. Layer Responsibilities

## Domain

Contains:

```text
entities

value objects

business rules

domain errors

invariants
```

Domain code should not depend directly on:

* PostgreSQL,
* Redis,
* HTTP,
* React,
* Nimiq SDK.

---

## Application

Contains use cases.

Examples:

```text
CreateService

CreatePass

PublishPass

CreatePassFromPurchase

GetCustomerPasses

BeginRedemption

CompleteRedemption
```

---

## Infrastructure

Contains technical implementations.

Examples:

```text
PostgreSQL repositories

Redis adapter

blockchain/payment verification adapters

logging

metrics
```

---

## HTTP Interface

Contains:

```text
routing

request parsing

validation

authentication extraction

response serialization
```

HTTP handlers should not contain large amounts of business logic.

---

# 25. Domain Modules

Initial domain modules should include:

```text
Identity

Provider

Service

Pass

Purchase

Pass

Redemption
```

Potential later modules may include:

```text
Notification

Analytics

Promotion
```

but only when genuinely required.

---

# 26. Identity Domain

Identity represents the actor using Nimpass.

Customer identity may be associated with:

```text
wallet address
```

and server-issued application session state.

Provider identity may require additional profile and authorization state.

Identity architecture must support:

```text
Customer

Provider

Customer + Provider
```

without forcing them to become separate accounts unnecessarily.

---

# 27. Wallet Address

Wallet addresses should be normalized according to Nimiq-supported canonical behavior before comparison.

Do not compare arbitrary user-entered strings without normalization.

The backend should treat public wallet address as an identifier, not as authentication by itself.

---

# 28. Address Does Not Equal Authentication

Knowing:

```text
NQxx....
```

does not prove the requester controls that wallet.

Therefore:

```text
wallet address
≠
authenticated wallet owner
```

Control should be proven through an appropriate authorization flow when necessary.

---

# 29. Wallet Authentication / Authorization Pattern

Where wallet ownership proof is required, prefer a challenge-signature model.

Conceptually:

```text
Client
    ↓
Request Challenge

Backend
    ↓
Creates short-lived nonce

Client
    ↓
Requests wallet signature
through Nimiq Pay

Nimiq Pay
    ↓
User approves

Client
    ↓
Signature returned to backend

Backend
    ↓
Verifies challenge

Backend
    ↓
Creates authenticated session
```

The exact cryptographic implementation belongs in `09-SECURITY.md`.

---

# 30. Challenge Properties

A wallet authorization challenge should conceptually include enough context to prevent reuse.

Examples:

```text
nonce

purpose

wallet

expiration

issued_at
```

Never use a static message such as:

```text
Sign this to login
```

for every authentication attempt indefinitely.

---

# 31. Provider Domain

Provider represents the service seller.

Conceptual fields:

```text
id

owner_identity_id

slug

display_name

bio

avatar

status

created_at

updated_at
```

Additional public fields may be added according to product requirements.

---

# 32. Service Domain

Service represents the underlying activity.

Example:

```text
Personal Training
```

Conceptual fields:

```text
id

provider_id

name

description

image

status

created_at

updated_at
```

A service is not directly a purchased pass.

---

# 33. Pass Domain

Pass represents a sellable commercial offering.

Example:

```text
10 Personal Training Sessions
250 NIM
```

Conceptual fields:

```text
id

provider_id

service_id

title

description

session_count

price

currency

expiration_policy

status

created_at

updated_at
```

For the initial Nimpass product:

```text
currency = NIM
```

There is no Pass type. The catalog table is `passes`.

---

# 34. Pass Status

Potential states:

```text
DRAFT

ACTIVE

UNAVAILABLE

ARCHIVED
```

Pass availability affects new purchases.

It must not automatically invalidate existing purchased Passes.

---

# 35. Purchased Pass Domain

Purchased Pass represents a customer's owned copy of a Pass, with independent session progress.

Conceptual fields:

```text
id

pass_id

provider_id

service_id

owner_identity_id

owner_wallet_address

original_session_count

used_session_count

remaining_session_count

purchase_id

status

created_at

expires_at

completed_at
```

The live table is `purchased_passes`. Customers see this as My Pass. Product language does not introduce a Package type.

---

# 36. Pass Snapshot Data

Purchased Passes must preserve relevant purchase-time Pass information.

Do NOT depend entirely on current live Pass values.

A purchased Pass may preserve fields such as:

```text
pass_title_snapshot

service_name_snapshot

provider_name_snapshot

session_count_snapshot

price_snapshot

currency_snapshot

expiration_snapshot
```

This prevents historical purchased Passes from changing when a provider edits the live Pass.

---

# 37. Pass Invariant

For every valid pass:

```text
original_session_count > 0

used_session_count >= 0

remaining_session_count >= 0

used_session_count + remaining_session_count
=
original_session_count
```

unless an explicitly documented future adjustment system exists.

---

# 38. Pass Status

Core states:

```text
PENDING

ACTIVE

COMPLETED

EXPIRED

CANCELLED
```

Application logic controls transitions.

---

# 39. Pass Lifecycle

Conceptually:

```text
PENDING
   ↓
ACTIVE
   │
   ├────→ EXPIRED
   │
   ├────→ CANCELLED
   │
   ↓
remaining = 0
   ↓
COMPLETED
```

Invalid state transitions must be rejected.

---

# 40. Purchase Domain

Purchase represents the commercial/payment lifecycle that may result in a pass.

Conceptual fields:

```text
id

customer_identity_id

wallet_address

pass_id

amount

currency

status

payment_reference

idempotency_key

created_at

confirmed_at
```

---

# 41. Purchase and Pass Are Different

Never model:

```text
purchase == pass
```

They are different domain concepts.

A purchase may be:

```text
PENDING
```

while no usable pass exists yet.

A successful purchase may later result in:

```text
ACTIVE PASS
```

---

# 42. Purchase Status

Conceptual states:

```text
CREATED

AWAITING_PAYMENT

VERIFYING

CONFIRMED

FAILED

CANCELLED
```

Additional internal states may exist if required.

Do not expose unnecessary complexity to users.

---

# 43. Payment Flow

Conceptually:

```text
Customer selects Pass
        ↓
Backend creates purchase intent
        ↓
Frontend requests NIM payment
        ↓
Nimiq Pay asks for approval
        ↓
User approves / cancels
        ↓
Frontend receives result
        ↓
Backend reconciles payment
        ↓
Purchase confirmed
        ↓
Pass created
```

---

# 44. Never Trust Frontend Payment Success

This request must never be sufficient:

```json
{
  "paymentSuccessful": true
}
```

from the client.

Frontend state is not authoritative proof.

Payment confirmation must follow the verification strategy defined by the Nimiq integration documentation.

---

# 45. Pass Creation Rule

The architecture must ensure:

```text
one successful intended purchase
→
one customer pass
```

not:

```text
one purchase
→
two passes
```

---

# 46. Purchase Idempotency

Pass creation must be idempotent.

Possible protections include:

```text
unique payment reference

unique purchase id

idempotency key

database unique constraint
```

Database-level enforcement is strongly preferred where possible.

---

# 47. Redemption Domain

Redemption represents one attempt to consume a session.

Conceptual fields:

```text
id

pass_id

provider_id

challenge_id

status

sessions_consumed

idempotency_key

created_at

authorized_at

completed_at
```

For standard redemption:

```text
sessions_consumed = 1
```

---

# 48. Redemption Challenge

A redemption may begin with a short-lived challenge.

Conceptually:

```text
challenge_id

pass_id

nonce

expires_at

status
```

Representation may be:

```text
QR

short code

secure link
```

Transport does not change the underlying domain behavior.

---

# 49. Redemption Is Server-Authoritative

The frontend must never perform:

```ts
remainingSessions -= 1
```

and treat that local change as authoritative.

Instead:

```text
Client requests redemption
        ↓
Server validates
        ↓
Database transaction updates pass
        ↓
Server returns new balance
        ↓
Client renders new balance
```

---

# 50. Atomic Redemption

A redemption must update state atomically.

Conceptually:

```text
BEGIN TRANSACTION

lock / conditionally update pass

verify remaining_sessions > 0

verify pass ACTIVE

verify redemption unused

remaining_sessions = remaining_sessions - 1

used_sessions = used_sessions + 1

insert redemption history

mark redemption complete

COMMIT
```

Either the whole operation succeeds or none of it does.

---

# 51. Prevent Negative Sessions

The database and application should both protect:

```text
remaining_sessions >= 0
```

Application validation alone is not enough.

Database constraints should reinforce core invariants when practical.

---

# 52. Duplicate Redemption Protection

If the same challenge is submitted multiple times:

```text
request 1
request 2
request 3
```

the result must be:

```text
one consumed session
```

not:

```text
three consumed sessions
```

Use:

* unique constraints,
* idempotency identifiers,
* transaction boundaries.

---

# 53. PostgreSQL as Source of Truth

PostgreSQL is the authoritative persistence layer.

It stores:

```text
providers

services

Passes

purchases

passes

redemptions

identity mappings

history-relevant state
```

Do not make Redis the authoritative store for permanent customer value.

---

# 54. Why PostgreSQL

Nimpass data contains strong relationships and transactional invariants.

Examples:

```text
Provider → Services

Service → Passes

Pass → Purchases

Purchase → Pass

Pass → Redemptions
```

PostgreSQL provides:

* ACID transactions,
* foreign keys,
* unique constraints,
* relational querying,
* mature Go support.

This is well aligned with Nimpass.

---

# 55. Redis Role

Redis is optional supporting infrastructure.

Potential uses:

```text
short-lived wallet challenges

short-lived redemption challenges

rate-limit state

distributed idempotency helpers

temporary cache
```

Do not introduce Redis when PostgreSQL already solves the problem cleanly.

---

# 56. Redis Must Not Own Permanent Value

Do not make Redis the only store for:

```text
remaining sessions

pass ownership

confirmed purchase

redemption history
```

Loss of Redis must not erase permanent customer entitlements.

---

# 57. Kafka Decision

Kafka is NOT required for the competition MVP.

Do not deploy Kafka merely because the backend foundation supports it.

Nimpass currently does not require distributed event streaming.

---

# 58. Future Domain Events

Internal application events may still exist conceptually.

Examples:

```text
PassPublished

PurchaseConfirmed

PassCreated

SessionRedeemed

PassCompleted
```

Initially they may be handled inside the modular monolith.

Kafka can only be introduced later when there is a demonstrated need.

---

# 59. REST API Structure

Recommended API namespace:

```text
/api/v1
```

Possible resources:

```text
/api/v1/providers

/api/v1/services

/api/v1/Passes

/api/v1/purchases

/api/v1/passes

/api/v1/redemptions
```

---

# 60. Public Endpoints

Examples:

```text
GET /api/v1/providers/{slug}

GET /api/v1/providers/{slug}/Passes

GET /api/v1/Passes/{id}
```

These endpoints power public discovery and Pass pages.

---

# 61. Provider Endpoints

Conceptual examples:

```text
POST /api/v1/provider/services

PATCH /api/v1/provider/services/{id}

POST /api/v1/provider/Passes

PATCH /api/v1/provider/Passes/{id}

POST /api/v1/provider/Passes/{id}/publish

GET /api/v1/provider/passes
```

Exact endpoint design may evolve while preserving REST semantics.

---

# 62. Customer Pass Endpoints

Conceptual examples:

```text
GET /api/v1/me/passes

GET /api/v1/me/passes/{id}

GET /api/v1/me/passes/{id}/history
```

Authorization must be enforced server-side.

---

# 63. Purchase Endpoints

Conceptual:

```text
POST /api/v1/purchases

GET /api/v1/purchases/{id}

POST /api/v1/purchases/{id}/reconcile
```

Do not expose an insecure endpoint such as:

```text
POST /purchases/{id}/mark-success
```

that trusts the client.

---

# 64. Redemption Endpoints

Conceptual:

```text
POST /api/v1/passes/{id}/redemption-challenges

POST /api/v1/redemptions/{id}/authorize

POST /api/v1/redemptions/{id}/complete
```

The exact final flow depends on the approved security model.

---

# 65. API Response Philosophy

Responses should be predictable.

Example success:

```json
{
  "data": {
    "id": "..."
  }
}
```

Error format should be consistent.

Conceptually:

```json
{
  "error": {
    "code": "PASS_COMPLETED",
    "message": "This pass has no sessions remaining."
  }
}
```

Do not expose raw database errors.

---

# 66. Domain Error Codes

Prefer stable machine-readable errors such as:

```text
PASS_NOT_FOUND

PASS_UNAVAILABLE

PURCHASE_NOT_FOUND

PAYMENT_NOT_CONFIRMED

PASS_NOT_FOUND

PASS_NOT_OWNED

PASS_COMPLETED

PASS_EXPIRED

REDEMPTION_EXPIRED

REDEMPTION_ALREADY_USED

UNAUTHORIZED
```

Frontend translates these into human-friendly UX.

---

# 67. Authentication vs Authorization

Keep these concepts separate.

Authentication:

> Who is making this request?

Authorization:

> Is this actor allowed to perform this action?

Example:

```text
Wallet proven
        ↓
Authenticated
```

does not automatically mean:

```text
Can edit Alex Fitness Pass
```

---

# 68. Authorization Examples

Customer:

```text
may read own passes

may authorize use of own pass
```

Provider:

```text
may edit own services

may edit own Passes

may validate passes belonging to their services
```

Unauthorized cross-provider access must be rejected.

---

# 69. Trust Boundary

Core trust boundaries:

```text
Browser
│
│ untrusted client
▼
Backend API
│
│ trusted business logic
▼
Database
```

and:

```text
Browser
│
▼
Nimiq Provider
│
▼
Nimiq Pay
│
▼
Wallet
```

The browser is never inherently trusted.

---

# 70. Client-Supplied Data

Treat all client values as untrusted.

Including:

```text
wallet address

provider id

Pass id

pass id

price

session count

payment result

remaining session count

redemption status
```

The backend must derive or verify authoritative values.

---

# 71. Price Authority

When purchasing Pass `X`, the frontend should not decide:

```json
{
  "amount": "1"
}
```

and override a Pass priced at 250 NIM.

The backend loads the current Pass terms and creates the intended purchase.

---

# 72. Historical Purchase Terms

Once a purchase is created, enough commercial information should be preserved to reconstruct what was purchased.

Do not depend entirely on mutable Pass state.

---

# 73. Time

Backend stores timestamps in:

```text
UTC
```

Frontend converts them to appropriate local presentation.

Do not store ambiguous local timestamps as canonical values.

---

# 74. IDs

Use non-sequential public-safe identifiers where practical.

For example:

```text
UUID
```

Exact version may follow the chosen backend conventions.

Do not expose database auto-increment assumptions throughout the domain.

---

# 75. Money Representation

Never represent NIM monetary values using binary floating-point for authoritative calculations.

Use an exact representation.

Conceptually:

```text
smallest integer denomination
```

or another exact numeric representation defined by the Nimiq integration.

The exact amount model must follow official Nimiq technical behavior.

---

# 76. Session Counts

Session counts are integer values.

Examples:

```text
5

10

12
```

Do not model:

```text
7.4 sessions
```

for the MVP.

---

# 77. Frontend Data Fetching

The frontend should centralize API communication.

Conceptually:

```text
src/
└── api/
    ├── client.ts
    ├── providers.ts
    ├── Passes.ts
    ├── passes.ts
    ├── purchases.ts
    └── redemptions.ts
```

Components should not contain duplicated raw fetch logic.

---

# 78. Server State

Remote server state should be treated differently from local UI state.

Examples of server state:

```text
Passes

passes

remaining sessions

purchase state

redemption history
```

Examples of local state:

```text
dialog open

selected tab

form draft

menu open
```

Do not duplicate authoritative server state into uncontrolled global state.

---

# 79. Frontend Routing

Recommended conceptual routes:

```text
/

/discover

/providers/:slug

/Passes/:id

/passes

/passes/:id

/provider

/provider/services

/provider/Passes

/provider/passes
```

Exact routes may change with UX refinement.

---

# 80. Public URLs

Provider and Pass pages should support shareable URLs.

Example concept:

```text
/provider/alex-fitness

/Pass/{id}
```

Prefer readable provider slugs where useful.

Pass URLs should never imply authorization merely because the URL is known.

---

# 81. Deep Linking

Shared links should preserve destination intent.

Example:

```text
Pass link
    ↓
Nimpass opens
    ↓
Pass shown directly
```

Do not force users through unrelated homepage flows.

---

# 82. Frontend Repository Structure

Recommended conceptual structure:

```text
frontend/
├── src/
│   ├── app/
│   ├── pages/
│   ├── components/
│   │   ├── ui/
│   │   ├── provider/
│   │   ├── Pass/
│   │   ├── pass/
│   │   └── payment/
│   │
│   ├── api/
│   ├── lib/
│   │   └── nimiq/
│   ├── hooks/
│   ├── types/
│   └── styles/
│
├── public/
├── index.html
├── vite.config.ts
└── Pass.json
```

Do not create excessively deep architecture without need.

---

# 83. Component Boundary

Prefer domain-oriented components.

Examples:

```text
PassCard

ProviderHeader

PassCard

SessionProgress

PaymentStatus

RedemptionChallenge
```

Avoid giant generic components that understand the entire application.

---

# 84. UI Library Rule

The frontend design implementation uses:

```text
shadcn/ui
Tailwind CSS
Lucide Icons
```

Do not introduce additional major component libraries such as:

```text
Material UI

Ant Design

Chakra UI
```

without an explicit architecture decision.

---

# 85. Nimiq SDK Rule

Nimiq-specific code must follow current official Nimiq documentation.

AI coding agents must NOT invent:

```text
SDK methods

provider events

payment methods

wallet capabilities
```

If uncertain, consult official documentation.

---

# 86. Mini App Capability Detection

The frontend should expose an internal capability model.

Conceptually:

```ts
type RuntimeCapabilities = {
  nimiqProviderAvailable: boolean
  walletOperationsAvailable: boolean
  insideNimiqPay: boolean
  transport: 'mini-app' | 'hub' | null
  // True when each wallet operation needs its own user gesture, because the
  // transport opens a browser popup and browsers grant one per activation.
  gesturePerOperation: boolean
}
```

The actual representation may differ.

The UX can then respond appropriately — but only through capabilities. A component that reads `transport` to decide behaviour has crossed the boundary §15 draws.

---

# 87. Public Browser Fallback

When the user is outside Nimiq Pay:

Public pages should continue working.

Example:

```text
Provider Page
Pass Page
Discover
```

must not crash because wallet APIs are absent.

Wallet-required actions should present an appropriate next step rather than a JavaScript exception.

---

# 88. Browser Wallet Architecture — Nimiq Hub (approved)

Do not implement a separate browser-wallet architecture simply to make desktop payment work unless explicitly approved.

**This was explicitly approved in September 2026.** Nimpass now supports two wallet transports, one product:

```text
Nimiq Pay WebView   ->  @nimiq/mini-app-sdk   (injected Nimiq provider)
ordinary browser    ->  @nimiq/hub-api        (the official Nimiq Hub)
```

The original rule was aimed at *unsupported wallet bridges* — invented provider shims, browser extensions, custom key handling. The Nimiq Hub is none of those: it is Nimiq's own first-party wallet interface, documented at `https://nimiq.github.io/hub`, and it keeps the same security boundary Nimiq Pay does. Private keys never enter Nimpass in either runtime (§19).

What did NOT change:

```text
one authentication model
one purchase lifecycle
one set of backend contracts
one security model
Nimiq Pay remains the Mini App wallet environment
```

Nimiq Pay is detected first and always wins, so a Mini App session never sees a Hub window. The Hub only fills the runtime where there previously was no wallet at all.

Still forbidden:

```text
private-key or seed-phrase handling
browser extensions as a requirement
faked provider or wallet state
a second, parallel business flow for desktop
treating "Open in Nimiq Pay" as the desktop wallet solution
```

Restricted Hub account-management methods (`login()`, `signup()`, `onboard()`, `export()`) are not used: a third-party application authenticates with `chooseAddress()` + `signMessage()`.

See `DECISIONS.md` (ADR-001) for the reasoning, the popup-blocker constraint, and the payment-reference decision.

---

# 89. Backend Deployment

The Go backend should be independently deployable as a containerized service.

Conceptually:

```text
Docker image
    ↓
Go server
    ↓
managed hosting
```

Possible infrastructure provider is an operational choice rather than domain architecture.

---

# 90. Frontend Deployment

Frontend deployment target:

```text
Vercel
```

Vite build output:

```text
dist/
```

Production configuration must use environment variables for API URLs and other public runtime configuration.

---

# 91. Database Deployment

PostgreSQL should use a managed production instance.

Production must not depend on a developer laptop database.

Use migrations for schema changes.

---

# 92. Migrations

Database schema changes must be version-controlled.

Conceptually:

```text
migrations/
001_initial.sql
002_Passes.sql
003_passes.sql
...
```

Do not modify production schema manually without migration history.

---

# 93. Seed Data

Development seed data may exist for:

* demo providers,
* services,
* Passes.

Seed data must never masquerade as real production purchases.

---

# 94. Environment Configuration

Secrets belong in environment configuration.

Examples:

```text
DATABASE_URL

REDIS_URL

API secrets
```

Do not commit real secrets.

Frontend environment variables must be assumed public unless the build system explicitly keeps them server-side.

---

# 95. Observability

At minimum, production backend should support:

```text
structured logs

health endpoint

request correlation

error logging
```

Useful later:

```text
metrics

tracing
```

Do not delay core product development for an enterprise observability platform.

---

# 96. Logging

Logs should help debug:

```text
purchase lifecycle

pass creation

redemption

authorization failure

unexpected errors
```

Do not log:

```text
private keys

seed phrases

sensitive signatures unnecessarily

secrets

full sensitive request bodies
```

---

# 97. Health Checks

Recommended:

```text
GET /health/live

GET /health/ready
```

Readiness may validate critical dependencies such as PostgreSQL.

Do not expose internal connection strings or raw infrastructure errors.

---

# 98. Rate Limiting

Rate limiting should protect abuse-sensitive endpoints.

Examples:

```text
wallet challenge creation

redemption challenge generation

payment reconciliation

authentication attempts
```

Implementation may use Redis or another appropriate strategy.

---

# 99. CORS

Production API must use a deliberate allowed-origin policy.

Do not combine unrestricted:

```text
*
```

with credentialed browser sessions.

Production origins should be explicitly configured.

---

# 100. HTTPS

Production communication must use:

```text
HTTPS
```

for frontend/API transport.

Sensitive wallet and authentication flows must not rely on insecure production HTTP.

---

# 101. Competition Architecture Constraint

The competition requires public source code under MIT.

This directly affects dependency and backend decisions.

Any code included in the competition repository must have compatible licensing.

---

# 102. masterfabric-go Status

`masterfabric-go` is technically attractive because its architecture provides concepts such as:

```text
Go

Chi

PostgreSQL

Redis

clean architecture

modular monolith

structured logging

health checks
```

These align well with Nimpass.

However, upstream licensing is currently a critical constraint.

---

# 103. masterfabric-go License Gate

The upstream `masterfabric-go` repository currently uses:

```text
GNU AGPL-3.0
```

while Nimpass competition code is required to be:

```text
MIT
```

Therefore:

> **Do not copy, vendor, fork, or build a derivative competition backend from masterfabric-go until license compatibility is explicitly resolved.**

This is a release blocker.

---

# 104. Allowed Architecture Path

Until the license issue is resolved, the safe architecture is:

```text
Study architectural ideas

↓

Implement independent Nimpass backend

↓

Go + Chi

↓

Own MIT-licensed implementation
```

Do not copy AGPL source into the MIT competition repository.

---

# 105. If masterfabric-go Is Relicensed

If upstream obtains a competition-compatible license or the project receives appropriate explicit permission, the architecture decision may be revisited.

Until then:

```text
masterfabric-go
=
reference architecture
```

not necessarily:

```text
copied backend source
```

---

# 106. Backend Minimalism

Even if using architectural inspiration from a larger platform, Nimpass should NOT automatically inherit:

```text
multi-tenant enterprise complexity

API gateway

Kafka

generic endpoint builder

complex RBAC framework

enterprise policy engine
```

unless the actual Nimpass domain needs it.

---

# 107. Nimpass Is Not Multi-Tenant SaaS Infrastructure

Providers are product users.

That does not automatically require an enterprise multi-tenant platform architecture.

Model Nimpass domain directly.

Do not force every concept through:

```text
organization
tenant
workspace
app
```

unless the product requirements actually introduce those concepts.

---

# 108. Roles

Initial authorization may use simple product roles:

```text
CUSTOMER

PROVIDER
```

A person may hold both capabilities.

Avoid complex enterprise RBAC before it is needed.

---

# 109. Database Transaction Boundaries

High-value transaction boundaries include:

```text
purchase confirmation → pass creation

redemption → session decrement → history insert
```

These flows should be atomic where possible.

---

# 110. Purchase Confirmation Transaction

Conceptually:

```text
BEGIN

verify purchase can transition

mark purchase confirmed

create pass if it does not exist

record event / history

COMMIT
```

Retrying must return the existing state instead of creating a duplicate pass.

---

# 111. Redemption Transaction

Conceptually:

```text
BEGIN

validate redemption

validate pass ACTIVE

validate remaining_sessions > 0

consume redemption challenge

decrement remaining

increment used

insert history

if remaining = 0:
    mark pass COMPLETED

COMMIT
```

---

# 112. Concurrency

Assume two requests can arrive at almost the same time.

Architecture must remain correct under:

```text
double click

two browser tabs

network retry

QR scanned twice

concurrent API requests
```

Correctness must not depend on requests arriving politely one at a time.

---

# 113. Database-Level Protection

Use database-level protection for critical invariants where practical.

Examples:

```text
UNIQUE(payment_reference)

UNIQUE(redemption_idempotency_key)

CHECK(remaining_sessions >= 0)

foreign keys
```

Application checks alone are insufficient for concurrency-sensitive invariants.

---

# 114. Cache Strategy

Do not cache sensitive mutable state aggressively.

Be particularly careful with:

```text
remaining session counts

pass status

purchase status
```

Incorrect stale data could mislead users about purchased value.

---

# 115. CDN / Static Content

Static assets such as:

```text
images

fonts

frontend bundles
```

may use standard CDN/platform delivery.

This should not affect authoritative application state.

---

# 116. Image Storage

If provider/service image uploads are supported, use object storage rather than database binary blobs.

Conceptually:

```text
object storage
+
database URL/reference
```

Exact provider can be selected later.

Do not block MVP development on complex media infrastructure.

---

# 117. Testing Strategy

Architecture should support multiple test levels.

## Domain tests

Test:

```text
pass invariants

status transitions

redemption rules
```

## Application tests

Test:

```text
purchase confirmation

pass creation

redemption

authorization
```

## Repository integration tests

Test against PostgreSQL where practical.

## HTTP tests

Test:

```text
status codes

validation

authorization

error formats
```

## End-to-end tests

Test actual customer/provider journeys.

---

# 118. Competition Critical Tests

At minimum, automate or manually verify:

```text
Pass creation

Pass loading

purchase intent creation

payment cancellation

payment failure

payment confirmation

single pass creation

pass persistence

session redemption

duplicate redemption

pass completion
```

---

# 119. Nimiq Integration Testing

Nimiq wallet flows must be tested inside the real supported Nimiq Pay Mini App environment.

Browser mocks alone are insufficient.

Test:

```text
provider initialization

account request

user rejection

payment approval

payment cancellation

signing where used
```

---

# 120. Development Environment

Local development should make it easy to run:

```text
Frontend

Backend

PostgreSQL

Optional Redis
```

Container tooling may be used for infrastructure.

Do not require Kafka for normal local Nimpass development.

---

# 121. Monorepo Direction

A recommended project layout is:

```text
nimpass/
├── frontend/
│   └── ...
│
├── backend/
│   └── ...
│
├── docs/
│   ├── 01-PRODUCT.md
│   ├── 02-USER-FLOWS.md
│   ├── 03-DESIGN-SYSTEM.md
│   ├── 04-NIMIQ-MINI-APPS.md
│   ├── 05-NIMIQ-PAY-INTEGRATION.md
│   ├── 06-COMPETITION.md
│   ├── 07-SCORING-STRATEGY.md
│   ├── 08-ARCHITECTURE.md
│   ├── 09-SECURITY.md
│   └── 10-SUBMISSION-CHECKLIST.md
│
├── CLAUDE.md
├── README.md
└── LICENSE
```

Keep product and backend source in one competition repository unless there is a deliberate reason not to.

---

# 122. Dependency Policy

Dependencies should be:

```text
necessary

actively maintained

appropriately licensed

small enough to justify
```

Do not install libraries for trivial functionality.

Every dependency increases:

* bundle size,
* security surface,
* maintenance cost,
* license considerations.

---

# 123. Major Dependency Rule

Do not introduce a major framework or infrastructure dependency without answering:

```text
What problem does it solve?

Can the existing stack solve it?

Does it improve competition reliability?

Does it introduce licensing risk?

Does it create operational complexity?
```

---

# 124. No Supabase Architecture

Nimpass does not depend on Supabase as its backend platform.

The selected backend architecture is:

```text
Go API
+
PostgreSQL
```

Do not create a parallel Supabase backend.

---

# 125. No Firebase Architecture

Do not introduce Firebase for:

* authentication,
* database,
* business logic,

without explicitly changing this architecture.

Nimpass should not have competing backend sources of truth.

---

# 126. No Direct Database from Frontend

Frontend must never directly connect to PostgreSQL.

Correct:

```text
Frontend
   ↓
API
   ↓
PostgreSQL
```

Incorrect:

```text
Frontend
   ↓
PostgreSQL
```

---

# 127. Business Logic Location

Business rules belong primarily in:

```text
Go domain/application layer
```

not in:

```text
React components

SQL triggers only

client-side utility files
```

Database constraints reinforce rules.

They do not replace the domain model.

---

# 128. API Versioning

Use versioned API routes:

```text
/api/v1
```

Breaking future API changes can introduce:

```text
/api/v2
```

Do not create version 2 prematurely.

---

# 129. Compatibility

Frontend and backend should be deployable independently.

The frontend must tolerate:

* transient API errors,
* loading,
* version-compatible additions.

The backend must not require exact frontend build hashes.

---

# 130. Failure Philosophy

Distributed operations can fail.

Architect for:

```text
retry

reconciliation

idempotency
```

rather than pretending every network request completes exactly once.

Especially important:

```text
payment

pass creation

redemption
```

---

# 131. Payment Recovery

If payment outcome is temporarily uncertain:

```text
Client loses connection

↓

Do not charge again immediately

↓

Backend checks existing purchase state

↓

Existing result is recovered
```

---

# 132. Redemption Recovery

If redemption response is lost:

```text
Request may have succeeded

↓

Retry same redemption identity

↓

Backend returns existing result

↓

No second session consumed
```

---

# 133. Auditability

Critical domain changes should leave enough history to explain state.

Examples:

```text
purchase confirmed

pass created

session redeemed

pass completed
```

This helps both:

* customer trust,
* operational debugging.

---

# 134. Event History vs Logs

Do not confuse:

```text
application log
```

with:

```text
customer-visible domain history
```

Logs may be deleted or rotated.

Pass history is durable product data.

---

# 135. Soft Delete

Avoid deleting historically significant financial/service records casually.

For example:

```text
completed pass

redemption history

confirmed purchase
```

should generally remain auditable.

Public availability may be disabled without destroying historical records.

---

# 136. Pass Deactivation

When a provider disables a Pass:

```text
New purchases
→ blocked
```

Existing passes:

```text
remain based on their own validity
```

unless a separately documented rule says otherwise.

---

# 137. Data Minimization

Store only data required for Nimpass functionality.

Do not collect:

```text
unnecessary personal information

wallet metadata without purpose

device data without need
```

Competition privacy rules and security principles apply.

---

# 138. Architecture and Privacy

A wallet address is public blockchain information but may still become user-associated application data.

Treat it responsibly.

Do not expose complete customer wallet lists publicly without a product requirement.

---

# 139. Architecture and Design

Backend architecture must support the UX defined in `03-DESIGN-SYSTEM.md`.

Technical shortcuts must not force users to understand:

```text
transaction hashes

database IDs

wallet internals
```

during normal flows.

---

# 140. Architecture and Competition

The architecture must directly support the competition scorecard.

## Reliability

Through:

```text
transactions

idempotency

clear states
```

## Nimiq Integration

Through:

```text
Mini App SDK

wallet interactions

NIM payments
```

## Design

Through:

```text
fast REST APIs

clean state boundaries
```

## Real Usage

Through:

```text
stable production deployment
```

---

# 141. MVP Infrastructure

Keep production infrastructure intentionally small.

Recommended:

```text
Vercel
│
└── Frontend

Go Host
│
└── Backend

Managed PostgreSQL
│
└── Persistent Data

Optional Managed Redis
│
└── Ephemeral Data
```

That is enough for the competition MVP.

---

# 142. What We Are NOT Deploying for MVP

Unless requirements change:

```text
Kubernetes

Kafka cluster

service mesh

multiple microservices

multiple databases

Elasticsearch

complex event bus

GraphQL gateway

API gateway platform
```

are not required.

---

# 143. Scalability Philosophy

Nimpass should be scalable enough to grow without becoming over-engineered.

Initial strategy:

```text
stateless Go API

horizontal API scaling

managed PostgreSQL

indexes

connection pooling

optional Redis
```

This architecture can support significantly more usage than the competition requires.

---

# 144. Database Indexing

Indexes should reflect actual query patterns.

Likely candidates:

```text
provider slug

provider_id

service_id

Pass status

owner identity

owner wallet

pass status

purchase payment reference

redemption challenge/idempotency key
```

Do not create indexes blindly.

---

# 145. Pagination

List endpoints should support pagination when collections can grow.

Examples:

```text
provider passes

activity history

customer pass history
```

Avoid unbounded database reads.

---

# 146. Validation

Input validation occurs at API boundaries.

Examples:

```text
session_count > 0

price > 0

title non-empty

supported status

valid identifier
```

Domain layer still enforces core invariants.

---

# 147. Server-Generated Fields

Clients should not be allowed to freely set fields such as:

```text
used_session_count

remaining_session_count

pass status

purchase confirmed_at

redemption completed_at
```

These belong to server workflows.

---

# 148. Architecture Security Boundary

Detailed security requirements live in:

```text
09-SECURITY.md
```

Architecture must nevertheless guarantee foundational security properties such as:

```text
no private keys

server-side authorization

idempotency

transactions

input validation

secret separation

HTTPS

safe error handling
```

---

# 149. Claude / AI Agent Architecture Rules

AI coding agents must:

1. Read this document before major architecture changes.
2. Preserve REST.
3. Preserve Go backend.
4. Preserve PostgreSQL as source of truth.
5. Preserve Nimiq integration boundary.
6. Preserve web-first runtime.
7. Preserve transactional pass/redemption logic.
8. Avoid microservice expansion.
9. Avoid introducing GraphQL.
10. Avoid introducing competing backend platforms.
11. Verify Nimiq methods against official documentation.
12. Check license compatibility before adding dependencies.

---

# 150. AI Agent — Do Not Invent Infrastructure

Do not automatically introduce:

```text
Kafka

RabbitMQ

Kubernetes

GraphQL

Supabase

Firebase

MongoDB

Elasticsearch

microservices
```

because they are common architecture patterns.

They must solve a demonstrated Nimpass requirement.

---

# 151. AI Agent — Domain First

When implementing a feature, identify:

```text
Domain object

Use case

Invariant

Authorization rule

Persistence requirement

API boundary

UI state
```

before writing code.

---

# 152. AI Agent — Critical State Rule

For:

```text
payment

pass creation

redemption
```

an AI agent must explicitly consider:

```text
retry

duplicate request

concurrency

refresh

network failure

partial failure
```

before calling the implementation complete.

---

# 153. Architecture Decision Summary

Binding current decisions:

```text
Frontend
React + Vite + TypeScript

Styling
Tailwind CSS

UI
shadcn/ui

Icons
Lucide

Blockchain Integration
@nimiq/mini-app-sdk inside Nimiq Pay
@nimiq/hub-api in an ordinary browser
(one wallet abstraction over both; see §88)

Backend
Go

HTTP
Chi

API
REST

GraphQL
NO

Primary Database
PostgreSQL

Redis
Optional / targeted

Kafka
NO for MVP

Architecture
Modular Monolith

Frontend Hosting
Vercel

Backend Hosting
Separate Go-capable container host

Wallet
Nimiq Pay

Primary Currency
NIM

Source Code License
MIT for competition submission

masterfabric-go
Architectural reference only until license issue is resolved
```

---

# 154. Final Architecture Principle

Nimpass architecture should make this flow boringly reliable:

```text
Pass
   ↓
NIM Payment
   ↓
Pass
   ↓
Session
   ↓
Redemption
   ↓
Updated Pass
```

The user should experience simplicity.

The complexity required for:

```text
payment verification

authorization

concurrency

idempotency

transactions

recovery
```

belongs behind the interface.

---

# Source-of-Truth Rule

This document defines the approved Nimpass architecture.

An implementation must not silently replace:

```text
REST
```

with:

```text
GraphQL
```

or:

```text
PostgreSQL
```

with another database,

or:

```text
Go
```

with another backend stack,

or introduce:

```text
microservices
Kafka
Supabase
Firebase
```

without an explicit architecture decision.

When an architecture change is proposed:

```text
1. Explain the problem.

2. Explain why the existing architecture cannot solve it adequately.

3. Evaluate competition impact.

4. Evaluate security impact.

5. Evaluate licensing impact.

6. Update this document.

7. Only then modify implementation.
```

---

# Relationship to Other Documentation

```text
01-PRODUCT.md
→ What Nimpass is

02-USER-FLOWS.md
→ How users move through Nimpass

03-DESIGN-SYSTEM.md
→ How Nimpass looks and behaves

04-NIMIQ-MINI-APPS.md
→ Nimiq Mini App runtime and APIs

05-NIMIQ-PAY-INTEGRATION.md
→ NIM payment and wallet integration

06-COMPETITION.md
→ Competition requirements

07-SCORING-STRATEGY.md
→ Competition optimization

08-ARCHITECTURE.md
→ Technical structure and boundaries

09-SECURITY.md
→ Threat model and security controls

10-SUBMISSION-CHECKLIST.md
→ Final competition readiness
```

No downstream implementation should redefine these architectural decisions without explicitly updating this document.

## September 2026 payment handoff update

ADR-005 supersedes the earlier primary Hub checkout description: desktop uses
an authenticated purchase locator QR, Nimiq Pay performs native payment, and
both observe the same backend purchase. `/purchases/:id` requires the same
customer identity.

ADR-009 names what selects between the two: the **device class**, decided once
in `frontend/web/src/lib/checkout-device.ts` and read only through
`useCheckoutDevice()`. Mobile calls `sendBasicTransactionWithData()`; desktop
shows the QR. The Purchase Intent is created before the branch, both branches
pay that same intent, and device class is never an input to identity,
authorisation or ownership. Wallet dispatch locks live in PostgreSQL (migration 000010).
The local launcher proxies `/api` on the frontend origin; production must use
its existing HTTPS ingress and explicit MAINNET configuration.
