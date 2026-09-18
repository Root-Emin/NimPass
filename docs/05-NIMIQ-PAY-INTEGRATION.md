# Nimpass — Nimiq Pay Integration

> **Document type:** Payment architecture and implementation source of truth
> **Project:** Nimpass
> **Status:** Active
> **Audience:** Developers, AI coding agents, security reviewers, product contributors
> **Depends on:** `01-PRODUCT.md`, `02-USER-FLOWS.md`, `04-NIMIQ-MINI-APPS.md`
> **Related:** `08-ARCHITECTURE.md`, `09-SECURITY.md`, `10-SUBMISSION-CHECKLIST.md`
> **Official platform sources:** Nimiq Developer Center — Mini Apps, Nimiq Provider API, Nimiq RPC/Web Client documentation; Nimiq Mini Apps Competition rules, FAQ and scoring documentation
> **Documentation snapshot:** September 2026
> **Primary purpose:** Define exactly how Nimpass creates, submits, verifies, reconciles, and recovers NIM Pass payments through Nimiq Pay.

---

# 1. Purpose

This file defines the complete Nimpass payment lifecycle.

It answers:

```text
How is a Pass price represented?

Who receives the NIM?

When is a purchase created?

When does Nimiq Pay become involved?

Which Nimiq API is called?

What does transaction success mean?

How is the transaction verified?

When is a pass created?

How are duplicate payments prevented?

What happens after refresh?

What happens when the wallet is cancelled?

What happens when payment is submitted but confirmation is delayed?

How is the purchased pass associated with a wallet?

How does the web-first Nimpass experience transition into Nimiq Pay?
```

This file is intentionally stricter than ordinary UI documentation.

Payment and pass creation are economic state transitions.

They must never depend only on frontend assumptions.

---

# 2. Fundamental Payment Principle

The canonical Nimpass purchase lifecycle is:

```text
PASS
   ↓
PURCHASE INTENT
   ↓
NIMIQ PAY
   ↓
NIM TRANSACTION
   ↓
TRANSACTION HASH
   ↓
SERVER-SIDE VERIFICATION
   ↓
PURCHASE CONFIRMED
   ↓
PURCHASED PASS
```

Never simplify this to:

```text
Buy button
   ↓
Wallet popup
   ↓
Pass created
```

That architecture is insufficient.

---

# 3. Nimiq Pay Is the Wallet Layer

Nimiq Pay runs Mini Apps in a WebView and injects wallet providers.

Sensitive wallet operations are handled by Nimiq Pay itself.

The Mini App requests an action.

Nimiq Pay shows the native confirmation UI.

The user's private keys stay within the wallet environment and do not become available to Nimpass.

Conceptually:

```text
NIMPASS
   ↓
request payment
   ↓
NIMIQ PROVIDER
   ↓
NIMIQ PAY
   ↓
native wallet confirmation
   ↓
user approval
   ↓
signed/broadcast transaction
   ↓
transaction hash returned
```

Nimpass must never implement private-key custody.

---

# 4. Official Nimiq Provider Initialization

Nimiq provider access should use:

```text
@nimiq/mini-app-sdk
```

and its `init()` helper.

The official API recommends `init()` so the application waits until Nimiq Pay has injected the provider.

Conceptually:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
```

Raw provider initialization should be isolated inside the Nimiq integration layer.

React components should not repeatedly initialize the provider themselves.

---

# 5. Canonical Nimpass Payment Currency

The Nimpass MVP uses:

```text
NIM
```

as its session-Pass payment currency.

The competition permits NIM, USDT, or both, but requires a meaningful Nimiq Pay integration. Using NIM or the wider Nimiq ecosystem also contributes to the Nimiq integration scoring category.

Current Nimpass decision:

```text
MVP
=
NIM ONLY
```

Do not introduce USDT merely because it is technically available.

USDT requires a separate explicit product decision.

---

# 6. NIM and Luna

Nimiq transaction values are denominated in:

```text
Luna
```

The official relationship is:

```text
1 NIM
=
100,000 Luna
```

`sendBasicTransaction()` and `sendBasicTransactionWithData()` both accept their `value` in Luna.

Examples:

```text
1 NIM
=
100,000 Luna

10 NIM
=
1,000,000 Luna

250 NIM
=
25,000,000 Luna
```

---

# 7. Canonical Price Representation

Nimpass must store authoritative prices as integer Luna.

Preferred database/domain representation:

```text
priceLuna = 25_000_000
```

not:

```text
price = 250.0
```

Display conversion:

```text
25,000,000 Luna
        ↓
250 NIM
```

Payment conversion:

```text
250 NIM display value
        ↓
25,000,000 Luna transaction value
```

The payment layer must never rely on floating-point currency calculations.

---

# 8. Precision Rule

Since:

```text
1 NIM = 100,000 Luna
```

one Luna equals:

```text
0.00001 NIM
```

Therefore the NIM denomination supports five decimal places at this unit level.

Pass-price validation must reject any price that cannot be represented exactly in Luna.

Example:

```text
VALID

1 NIM
1.5 NIM
1.23456 NIM
```

Example:

```text
INVALID

1.234567 NIM
```

if the seventh decimal would require a fraction of a Luna.

---

# 9. One Conversion Utility

NIM/Luna conversion must be centralized.

Conceptually:

```text
nimToLuna()

lunaToNim()

formatNim()
```

Do not implement currency conversion independently in:

```text
Pass card

checkout page

provider editor

payment modal

backend verification

history
```

using different formulas.

There must be one canonical representation.

---

# 10. Payment Recipient Model

Current Nimpass MVP decision:

> **The provider receives the customer's NIM directly.**

Conceptually:

```text
CUSTOMER WALLET
        ↓
      NIM
        ↓
PROVIDER WALLET
```

Nimpass does not take custody of customer funds.

Nimpass is therefore not:

```text
a custodial wallet

an escrow service

a pooled payment account

a cryptocurrency exchange
```

---

# 11. Provider Payout Address

Each provider must have an approved Nimiq payout address.

Conceptually:

```text
Provider

Alex Fitness

Payout Wallet
NQ...
```

This address is used when Nimpass constructs Pass-payment instructions.

It must come from trusted server-side provider configuration.

---

# 12. Provider Payout Address Must Be Verified

A provider must not simply type an arbitrary Nimiq address and immediately make it trusted.

In Nimpass a provider never types one at all. The first payout address is the
wallet that signed in, adopted server-side from the session when the provider
record is created, and the sign-in signature is the proof of control
(`DECISIONS.md` ADR-025):

```text
Sign in — challenge signed with Nimiq Pay
       ↓
Backend verifies proof, identity holds the wallet
       ↓
Provider created → payout address VERIFIED
```

Changing it to a *different* address is the case this section is about, and it
keeps the full ceremony:

```text
Provider names the new address
       ↓
Backend creates verification challenge
       ↓
Provider signs challenge with Nimiq Pay
       ↓
Backend verifies proof, plus a step-up from the login wallet
       ↓
Payout address becomes VERIFIED
```

The Nimiq provider officially supports `listAccounts()` and `sign()`, with user approval for both operations.

The detailed signature protocol belongs in:

```text
09-SECURITY.md
```

---

# 13. Never Trust Recipient From the Browser

The client must never be allowed to decide the authoritative recipient.

Incorrect:

```text
POST /purchase

{
  passId: "...",
  recipient: "NQ..."
}
```

where the backend blindly trusts `recipient`.

Correct:

```text
passId
    ↓
backend loads Pass
    ↓
backend loads provider
    ↓
backend loads VERIFIED payout wallet
    ↓
purchase intent stores recipient
```

The recipient is server-derived.

---

# 14. Never Trust Price From the Browser

Similarly, the client must not submit the authoritative Pass price.

Incorrect:

```text
{
  passId: "pass_123",
  price: 1
}
```

Correct:

```text
{
  passId: "pass_123"
}
```

Backend:

```text
load Pass

verify available

read authoritative priceLuna

snapshot price

create purchase intent
```

---

# 15. Pass Snapshot Principle

A Pass describes the current offer.

A purchase describes the terms actually purchased.

Therefore creating a purchase intent snapshots:

```text
passId

providerId

serviceId

passTitle

sessionCount

priceLuna

recipientAddress

expiration rules

network

currency
```

where relevant.

This prevents later Pass editing from mutating an existing payment operation.

---

# 16. Example Pass

Current Pass:

```text
10 Personal Training Sessions

Provider
Alex Fitness

Sessions
10

Price
250 NIM
```

Authoritative internal amount:

```text
25,000,000 Luna
```

Purchase snapshot:

```text
passId
pkg_training_10

sessions
10

priceLuna
25000000

currency
NIM

recipient
NQ...
```

---

# 17. Purchase Intent

Every payment begins with a server-side:

```text
Purchase Intent
```

before a NIM transaction is requested.

Conceptually:

```text
PurchaseIntent {
    id

    passId

    providerId

    serviceId

    sessionCount

    priceLuna

    currency

    recipientAddress

    network

    status

    createdAt

    expiresAt

    transactionHash?
}
```

Exact schema belongs in `08-ARCHITECTURE.md`.

The concept itself is mandatory.

---

# 18. Why Purchase Intent Exists

Without a purchase intent:

```text
wallet payment
```

has no robust application identity.

A purchase intent allows Nimpass to answer:

```text
Which Pass was being purchased?

Which price did the user approve?

Which provider should receive payment?

Was this payment already processed?

Did a pass already get created?

Can this operation safely be retried?
```

---

# 19. Purchase Intent Status Model

Recommended conceptual states:

```text
CREATED

AWAITING_PAYMENT

TRANSACTION_SUBMITTED

VERIFYING

CONFIRMED

PASS_CREATING

COMPLETED
```

Alternative terminal/interruption states:

```text
CANCELLED

FAILED

EXPIRED

REJECTED
```

A separate state may exist for:

```text
VERIFICATION_DELAYED
```

when the transaction was submitted but blockchain verification is not yet conclusive.

---

# 20. Purchase Intent Creation

Customer chooses:

```text
[ Buy Pass ]
```

Frontend requests:

```text
createPurchaseIntent(passId)
```

Backend must verify:

```text
Pass exists

Pass is published

Pass is available

provider exists

provider can receive payments

provider payout address is verified

sessionCount > 0

priceLuna > 0

currency = NIM

expected network configured
```

Only then is an intent created.

---

# 21. Purchase Intent Expiration

Purchase intents should have a finite lifetime.

Purpose:

```text
prevent ancient payment instructions
prevent stale Pass terms
simplify reconciliation
prevent indefinite checkout reuse
```

Exact expiration duration belongs to architecture/configuration.

Do not confuse:

```text
purchase intent expiration
```

with:

```text
Nimiq transaction validity
```

They are separate concepts.

---

# 22. Purchase Intent Response

The frontend may receive data such as:

```text
purchaseIntentId

displayPass

displayProvider

sessionCount

priceNim

priceLuna

recipientAddress

network

expiresAt
```

The frontend uses this information for display and wallet request construction.

However the backend retains the authoritative copy.

---

# 23. Canonical Payment API Choice

For Nimpass Pass purchases, the intended Nimiq provider method is:

```text
sendBasicTransactionWithData()
```

rather than implementing custom transaction signing.

The official provider supports basic NIM transfers with text data and returns the transaction hash after native wallet approval.

---

# 24. Why Transaction Data Is Used

Nimpass uses the transaction-data field to attach an **opaque purchase reference**.

Example conceptual payload:

```text
NP:<opaque-purchase-reference>
```

Its purpose is:

```text
payment ↔ purchase correlation
```

not customer identification.

---

# 25. Transaction Data Must Remain Non-Sensitive

Transaction data may become observable on the blockchain.

Therefore never put:

```text
customer name

email

phone number

session notes

provider notes

authentication token

JWT

API key

private pass details
```

into transaction data.

Use only an opaque application reference.

---

# 26. Transaction Data Size

Nimiq basic transactions with data support a limited arbitrary data payload; the Nimiq Web Client documentation describes up to 64 bytes for transaction data.

Therefore the purchase reference should be compact.

Prefer:

```text
NP:<compact opaque ID>
```

rather than serializing a JSON purchase object into the blockchain.

---

# 27. Transaction Data Is Not the Database

The blockchain data field is not a substitute for Nimpass storage.

Do not encode:

```text
Pass

customer

session count

history

pass state
```

into transaction data.

Nimpass backend remains responsible for product state.

---

# 28. Canonical Payment Request

Conceptually:

```ts
const txHash = await nimiq.sendBasicTransactionWithData({
  recipient: intent.recipientAddress,
  value: intent.priceLuna,
  data: intent.paymentReference,
})
```

The official provider requires:

```text
recipient
value in Luna
data
```

and requests native user confirmation.

Fee and validity fields should normally be left to the provider/default policy unless a specific architecture decision requires otherwise.

---

# 29. Do Not Manually Guess Fees

The official provider allows an optional fee, and Nimiq Pay can choose a fee automatically.

Nimpass should therefore avoid hardcoding arbitrary payment fees in the client.

Initial rule:

```text
Do not provide custom fee
unless explicitly required.
```

---

# 30. Validity Start Height

`sendBasicTransactionWithData()` also supports an optional:

```text
validityStartHeight
```

The MVP does not need to manually supply one unless a demonstrated technical reason appears.

Avoid unnecessary blockchain-level configuration.

---

# 31. Native Wallet Confirmation

Calling the transaction method causes Nimiq Pay to request user approval.

The user must be able to understand:

```text
recipient

amount

wallet action
```

through the native wallet flow.

Nimpass should prepare the user before the native confirmation.

Example:

```text
10 Personal Training Sessions

Alex Fitness

10 sessions

250 NIM

[ Continue to Nimiq Pay ]
```

---

# 32. Frontend Must Not Fake Approval

Do not create an imitation Nimiq Pay modal such as:

```text
Enter wallet password

Enter seed phrase

Confirm private key
```

Nimpass never collects those credentials.

Native wallet approval belongs to Nimiq Pay.

---

# 33. Transaction Hash

A successful provider call returns:

```text
transaction hash
```

for the submitted transaction.

Example conceptual state:

```text
txHash = "..."
```

This means Nimpass now has a blockchain transaction identifier.

It does **not** mean:

```text
pass should immediately be trusted as active
```

---

# 34. Critical Rule — Hash Is Not Final Business Success

Never implement:

```text
sendBasicTransactionWithData()
        ↓
returns hash
        ↓
set payment = SUCCESS
        ↓
create pass locally
```

Instead:

```text
returns hash
        ↓
submit hash to backend
        ↓
backend verifies transaction
        ↓
purchase confirmed
        ↓
pass created
```

---

# 35. Frontend Reports Transaction Hash

After Nimiq Pay returns the hash:

```text
confirmPurchaseTransaction(
    purchaseIntentId,
    txHash
)
```

The frontend is reporting:

> “This is the transaction that appears to belong to my purchase.”

It is not declaring:

> “This transaction is valid.”

The backend decides that.

---

# 36. Transaction Hash Uniqueness

A blockchain transaction hash must not successfully settle multiple Nimpass purchases.

Database/business constraint:

```text
transactionHash
UNIQUE
```

within the applicable network/payment system.

If:

```text
txHash X
```

has already settled:

```text
Purchase A
```

it cannot settle:

```text
Purchase B
```

---

# 37. Backend Blockchain Verification

Nimiq provides backend-friendly blockchain access through its RPC API.

The official RPC documentation specifically describes the RPC API as suitable for backend integrations and exposes methods including:

```text
getTransactionByHash
```

for transaction lookup.

Nimpass payment verification belongs on the backend.

---

# 38. Transaction Lookup

Given:

```text
txHash
```

the backend obtains transaction details through its configured Nimiq blockchain integration.

Nimiq's Web Client documentation also exposes transaction lookup by hash and provides transaction information such as:

```text
sender

recipient

value

state
```

This data is what Nimpass must compare against its purchase intent.

---

# 39. Verification Checklist

A NIM payment is not accepted until the backend establishes all relevant properties.

At minimum verify:

```text
transaction exists

network is expected network

transaction hash matches submitted hash

transaction sender is valid

transaction recipient matches purchase intent

transaction value matches purchase intent exactly

transaction is sufficiently included/confirmed

transaction has not settled another purchase

transaction data matches expected purchase reference

purchase intent is still valid for this settlement

purchase has not already completed
```

---

# 40. Recipient Verification

Expected:

```text
intent.recipientAddress
```

Actual:

```text
transaction.recipient
```

Requirement:

```text
actualRecipient
=
expectedRecipient
```

If not:

```text
PAYMENT_REJECTED
```

even if the amount is correct.

---

# 41. Amount Verification

Expected:

```text
intent.priceLuna
```

Actual:

```text
transaction.value
```

Requirement:

```text
actualValue
=
expectedValue
```

Do not automatically accept:

```text
actualValue < expectedValue
```

or:

```text
actualValue > expectedValue
```

as a successful Pass purchase.

Unexpected values require explicit reconciliation policy.

---

# 42. Why Exact Amount Matters

Suppose the Pass costs:

```text
250 NIM
```

Expected:

```text
25,000,000 Luna
```

Received:

```text
24,999,999 Luna
```

The payment is not the exact Pass payment.

Similarly:

```text
26,000,000 Luna
```

must not silently change the Pass or create additional sessions.

Pass semantics are not derived from arbitrary payment amount.

---

# 43. Sender Becomes Pass Owner

The MVP does not require a separate account-list prompt before every purchase.

After blockchain verification, the transaction exposes its sender.

Current rule:

```text
verified transaction sender
=
purchased pass owner wallet
```

Conceptually:

```text
Customer pays from Wallet A
        ↓
verified tx.sender = Wallet A
        ↓
Pass.ownerWallet = Wallet A
```

This avoids an unnecessary second wallet confirmation during purchase.

---

# 44. Gifting Is Not MVP Behavior

Because:

```text
payment sender
=
pass owner
```

the initial Nimpass product does not support:

```text
buy this pass for another wallet
```

as part of the normal purchase flow.

Pass gifting requires a separate explicit product and security design.

Do not infer gifting automatically.

---

# 45. Transaction Data Verification

Expected:

```text
intent.paymentReference
```

Actual:

```text
transaction data
```

Requirement:

```text
actual reference
=
expected reference
```

This creates a stronger correlation between:

```text
on-chain transaction

and

server-side purchase intent
```

---

# 46. Confirmation Policy

Nimiq transaction information can expose transaction state such as:

```text
pending

included
```

and transaction detail structures can include confirmation information.

Nimpass must maintain an explicit confirmation policy.

The policy is backend configuration, never a per-request choice and never a
frontend one:

```text
NIMIQ_CONFIRMATION_POLICY=inclusion   (default)
NIMIQ_CONFIRMATION_POLICY=finality
```

An unrecognised value fails startup. There is no silent fallback: a deployment
that cannot say which risk it accepted does not start.

Under `inclusion`:

```text
A transaction must be included in the expected Nimiq chain,
and must pass the entire verification checklist in §39,
before the purchase becomes CONFIRMED.
```

Under `finality` the same checks apply and the purchase additionally waits for
the macro block that makes the inclusion irreversible.

Albatross produces a micro block in roughly a second and a macro block at fixed
multiples of the batch length, so `finality` adds an arbitrary wait of up to
about a minute to every checkout — for a payment that was already on chain.
`inclusion` is the default for that reason, and the trade it makes is recorded
in ADR-021 rather than assumed here.

The policy governs the *wait*, never the *validation*. Every check in §39 to
§45 runs before a receipt exists under either policy, and §47 holds absolutely:
a transaction seen only in the mempool confirms nothing.

## Settlement is a state of its own

Because the purchase can be complete while the payment is not yet irreversible,
the receipt carries its own state, separate from the purchase's:

```text
INCLUDED    accepted, canonically included, macro block still pending
FINALIZED   the macro block was observed and still contains the transaction
CONTESTED   the transaction stopped being canonical and the deadline passed
```

`INCLUDED` is reported to clients as `settlement.provisional`. It exists to
*describe* a purchase, never to gate what the customer may see: a completed
purchase with a provisional settlement is the normal outcome of a fast checkout,
and withholding the Pass on it would reintroduce the wait this policy removes.

Finality tracking continues in the background after the Pass exists. Promotion
re-reads the chain and compares it against the stored receipt rather than
trusting block height alone, so a reorg is detected rather than finalised
through. A transaction that stops being canonical opens a compensation case
instead of leaving a paid-looking purchase in place — and that case is the one
kind where the customer *may* pay again, because no NIM ever left their wallet.
ADR-021 records what the worker may and may not conclude.

---

# 47. Never Create Pass From Pending Transaction Alone

If the transaction is:

```text
PENDING
```

customer UI may show:

```text
Confirming your payment…
```

but backend must not yet mark:

```text
Purchase = COMPLETED
```

or create a usable:

```text
ACTIVE PASS
```

under the standard flow.

---

# 48. Transaction Verification Result States

Backend verification may result in:

```text
NOT_FOUND

PENDING

VALID_INCLUDED

WRONG_RECIPIENT

WRONG_VALUE

WRONG_REFERENCE

WRONG_NETWORK

ALREADY_USED

INVALID

RPC_UNAVAILABLE
```

These should map into purchase-domain states rather than exposing RPC details directly.

---

# 49. Verification Is Idempotent

Calling:

```text
verifyPurchase(intentId)
```

multiple times must be safe.

Example:

```text
first verification
→ included
→ purchase confirmed
→ pass created

second verification
→ returns same completed purchase/pass
```

not:

```text
second verification
→ second pass
```

---

# 50. Atomic Purchase Completion

The final business transition must be atomic.

Conceptually:

```text
BEGIN DATABASE TRANSACTION

lock purchase intent

verify not completed

mark payment confirmed

persist tx hash

persist sender wallet

create pass

link pass to purchase

mark purchase completed

COMMIT
```

If any required operation fails:

```text
ROLLBACK
```

The exact database implementation belongs in `08-ARCHITECTURE.md`.

The atomicity requirement belongs here.

---

# 51. Pass Creation Uniqueness

At minimum enforce logical uniqueness such as:

```text
one completed purchase intent
→ maximum one pass
```

Recommended database protections include unique constraints around:

```text
purchaseId

transactionHash
```

where appropriate.

Never rely only on:

```text
if (!passExists)
```

in application code without database-level protection.

---

# 52. Canonical Pass Creation

After payment confirmation:

```text
Pass {
    purchaseId

    ownerWallet

    providerId

    serviceId

    passSnapshot

    originalSessions

    usedSessions = 0

    remainingSessions = originalSessions

    status = ACTIVE

    createdAt
}
```

Example:

```text
Personal Training

Alex Fitness

10 sessions purchased

0 used

10 remaining

ACTIVE
```

---

# 53. Payment and Pass Are Separate State Machines

Never merge:

```text
payment status
```

and:

```text
pass status
```

into one generic:

```text
status
```

Payment may be:

```text
PENDING

CONFIRMED

FAILED
```

while pass may be:

```text
PENDING

ACTIVE

COMPLETED

EXPIRED

CANCELLED
```

These are different concepts.

---

# 54. Successful Payment With Delayed Pass Creation

Possible scenario:

```text
transaction valid
        ↓
purchase confirmed
        ↓
temporary database/service failure
        ↓
pass not yet visible
```

Customer must see:

```text
Payment received.

We're preparing your pass.

You do not need to pay again.
```

The recovery process should retry pass provisioning idempotently.

---

# 55. Never Ask for Second Payment After Confirmed Transaction

Once payment is confirmed:

```text
TRY AGAIN PAYMENT
```

must not be offered as the recovery action for pass-creation failure.

Correct recovery:

```text
reconcile existing purchase
```

not:

```text
create another transaction
```

---

# 56. Payment State Machine

Canonical model:

```text
INTENT_CREATED
      ↓
AWAITING_WALLET
      ↓
TRANSACTION_SUBMITTED
      ↓
VERIFYING
      ↓
 ┌────┼────────────┐
 ↓    ↓            ↓
PENDING REJECTED CONFIRMED
                 ↓
            PASS_CREATING
                 ↓
             COMPLETE
```

Interruption paths:

```text
AWAITING_WALLET
→ CANCELLED

AWAITING_WALLET
→ FAILED

VERIFYING
→ VERIFICATION_DELAYED
```

---

# 57. Wallet Cancellation

The provider can throw:

```text
PermissionDeniedError
```

when the user rejects the confirmation dialog.

This should map to:

```text
PAYMENT_CANCELLED
```

not:

```text
SYSTEM_FAILURE
```

User-facing experience:

```text
Payment cancelled.

No completed purchase was created.

[ Try Again ]
```

---

# 58. Invalid Transaction Error

The Nimiq provider documents:

```text
InvalidTransactionError
```

for malformed transaction requests.

This represents an implementation or data problem.

User-facing UI should remain understandable:

```text
Payment couldn't be prepared.

Please try again.
```

Technical details belong in logging/monitoring.

---

# 59. Provider Initialization Failure

Possible:

```text
Nimiq Pay provider unavailable

provider initialization timeout

Mini App not running in expected environment
```

Do not allow wallet-dependent UI to crash.

Possible state:

```text
Nimiq Pay isn't available right now.

Open Nimpass in Nimiq Pay to complete the purchase.
```

---

# 60. Network Failure Before Wallet Submission

If the transaction was definitely not submitted:

```text
Payment could not be started.

No payment was sent.

[ Try Again ]
```

This case is safe to retry.

---

# 61. Network Failure After Transaction Submission

Critical case:

```text
wallet approved

transaction may have been broadcast

frontend loses connection
```

Never immediately say:

```text
Payment failed.
```

Instead:

```text
Checking your payment…

Do not send another payment yet.
```

The backend must reconcile the existing purchase.

---

# 62. Uncertain Payment Principle

When Nimpass cannot determine whether a transaction exists:

```text
UNKNOWN
```

is a valid state.

It is safer than incorrectly claiming:

```text
FAILED
```

because false failure messaging can cause duplicate payments.

---

# 63. Reconciliation

Payment reconciliation means:

```text
given purchase intent

determine current authoritative result
```

using available information such as:

```text
stored txHash

payment reference

expected recipient

expected amount

blockchain transaction data
```

Possible result:

```text
still pending

confirmed

invalid

not found

already completed
```

---

# 64. Background Reconciliation

Backend may periodically revisit:

```text
TRANSACTION_SUBMITTED

VERIFYING

VERIFICATION_DELAYED
```

purchases.

This allows recovery when:

```text
client closes

mobile app backgrounds

network fails

frontend never calls completion endpoint
```

A customer should not need to keep the screen open for Nimpass to eventually recognize a valid submitted payment.

---

# 65. Client Reconciliation

When the user returns to a purchase route:

```text
GET purchase status
```

should return the authoritative state.

Example:

```text
User closes Nimiq Pay
       ↓
returns later
       ↓
Nimpass loads purchase
       ↓
COMPLETE
       ↓
View Pass
```

Do not restart payment automatically.

---

# 66. Browser Refresh

During:

```text
VERIFYING
```

a refresh must result in:

```text
recover purchase intent

load current status

continue verification
```

not:

```text
create new purchase intent

request second payment
```

---

# 67. Double Click Protection

Frontend must disable repeated purchase submission while an active purchase action exists.

Example:

```text
[ Buy Pass ]
     ↓
Preparing payment…
[ disabled ]
```

But frontend disabling alone is insufficient.

Backend idempotency is still mandatory.

---

# 68. Purchase Intent Idempotency

Repeated intent requests caused by:

```text
double click

network retry

client retry
```

should be safely deduplicated when they represent the same logical operation.

The exact idempotency-key strategy belongs in architecture.

Conceptually:

```text
Idempotency-Key
```

may be associated with intent creation.

---

# 69. Transaction Reuse Attack

An attacker must not be able to submit:

```text
old valid txHash
```

to settle a new purchase.

Protections include:

```text
unique txHash

purchase reference validation

recipient comparison

amount comparison

sender extraction

network comparison

intent lifecycle validation
```

---

# 70. Same Amount Collision

Two Passes may legitimately cost:

```text
250 NIM
```

Therefore:

```text
recipient + amount
```

alone is not a sufficient purchase identifier.

The transaction reference strengthens purchase-level correlation.

---

# 71. Payment Reference

The reference must be:

```text
opaque

unique

non-sensitive

short

server-generated
```

It must not be:

```text
customer email

provider slug only

Pass title

sequential guessable purchase number
```

unless another layer makes the result safe.

---

# 72. Payment Reference Example

Conceptually:

```text
NP:7D4F8G2K9M...
```

Backend relationship:

```text
paymentReference
      ↓
PurchaseIntent.id
```

The public reference does not need to reveal the internal database identifier directly.

---

# 73. Wrong Recipient

If transaction lookup produces:

```text
expected:
Alex wallet

actual:
different wallet
```

Nimpass must not activate the pass.

State:

```text
PAYMENT_REJECTED
```

This protects against manipulated checkout data.

---

# 74. Wrong Amount

If:

```text
expected:
25,000,000 Luna

actual:
20,000,000 Luna
```

do not create the pass.

The customer may require support/reconciliation if real funds were sent incorrectly.

The UI must not pretend the payment never occurred when blockchain evidence says funds moved.

---

# 75. Overpayment

If actual value exceeds expected value:

```text
actual > expected
```

the Pass must still not silently change.

Do not automatically create:

```text
extra sessions
```

based on overpayment.

Overpayment/refund handling requires a separate business policy.

---

# 76. Refunds

Automatic refunds are not part of the initial Nimpass MVP unless explicitly implemented later.

Do not invent:

```text
refund button

automatic cancellation refund

partial refund
```

without product, security and accounting rules.

Payment verification architecture should preserve enough records to support future manual investigation.

---

# 77. Payment History

A customer purchase history may display:

```text
10 Personal Training Sessions

250 NIM

Payment confirmed

Purchased Sep 12
```

Optional deeper details:

```text
transaction hash
```

may be exposed where useful.

Technical blockchain information should not dominate the normal UX.

---

# 78. Provider Payment History

Provider operational history may show:

```text
Pass purchased

10 Personal Training Sessions

250 NIM

Customer pass created
```

Do not unnecessarily expose full customer wallet addresses in ordinary provider lists.

---

# 79. Wallet Address Privacy

Wallet addresses are blockchain addresses, but linking them to:

```text
customer identity

service purchased

usage history
```

creates application-level privacy implications.

Display only as much wallet information as operationally necessary.

---

# 80. No Sensitive Data On-Chain

Nimpass must never intentionally place:

```text
customer identity

health information

session notes

provider private notes

emails

phone numbers
```

into Nimiq transaction data.

Only opaque payment correlation belongs there.

---

# 81. Web-First Purchase Entry

Because Nimpass is web-first, a customer may begin here:

```text
ordinary browser
```

without Nimiq provider access.

Flow:

```text
Public Pass
      ↓
Buy Pass
      ↓
wallet capability required
      ↓
Open / Continue in Nimiq Pay
      ↓
same Pass
      ↓
payment
```

---

# 82. Nimiq Pay Deep Link

The Nimiq Developer Center provides mechanisms for opening a published Mini App directly inside Nimiq Pay, including custom-scheme and HTTPS mini-app opener links.

Nimpass should use the officially documented mechanism rather than inventing its own mobile-app URL scheme.

---

# 83. Preserve Pass Context

Browser:

```text
/nimpass/provider/alex/Pass/training-10
```

must transition conceptually to:

```text
Nimiq Pay
      ↓
same Pass
```

not:

```text
Nimiq Pay
      ↓
generic homepage
```

The user should never have to search for the Pass again.

---

# 84. Purchase Intent Across Browser → Nimiq Pay

Two valid strategies exist:

```text
A.
Create intent before handoff

B.
Preserve Pass context and create intent
after Nimiq Pay opens
```

Current recommended strategy:

```text
Pass context is preserved

purchase intent is created/revalidated
inside the wallet-capable flow
immediately before payment
```

This minimizes stale intents created by users who never reach Nimiq Pay.

---

# 85. Never Put Trusted Financial Values in Deep Link

The browser may carry:

```text
Pass identifier
```

but must not establish authoritative:

```text
recipient

price

session quantity
```

through query parameters.

Bad:

```text
?price=1&recipient=NQ_ATTACKER
```

Trusted values are reloaded server-side.

---

# 86. Purchase Review Before Wallet Call

Immediately before requesting NIM payment:

```text
Alex Fitness

10 Personal Training Sessions

10 sessions

250 NIM

[ Pay 250 NIM ]
```

The customer should know what will happen before the native wallet dialog appears.

---

# 87. Do Not Request Wallet Access Too Early

Nimiq's wallet operations require native confirmation in relevant cases.

Therefore public browsing should not repeatedly trigger wallet prompts.

Preferred:

```text
Browse
→ Pass
→ Buy
→ Payment
```

not:

```text
Homepage
→ wallet prompt

Provider
→ wallet prompt

Pass
→ wallet prompt
```

---

# 88. Buyer Account Discovery

Purchase itself does not require a separate `listAccounts()` call solely to discover the buyer.

The blockchain transaction sender becomes the purchase wallet after backend verification.

This reduces wallet-prompt friction.

`listAccounts()` may still be used elsewhere for:

```text
My Passes

wallet-based authentication

provider payout setup
```

where appropriate.

---

# 89. Returning Customer Authorization

Payment created:

```text
Pass.ownerWallet
```

from the verified transaction sender.

When the user returns later, Nimpass must establish that the active wallet controls or corresponds to that address before exposing protected pass operations.

The exact wallet-authentication mechanism belongs in:

```text
09-SECURITY.md
```

Potential Nimiq primitives include:

```text
listAccounts()

sign()
```

both officially supported by the Nimiq provider.

---

# 90. Payment Does Not Equal Authentication

A payment transaction proves that its sender authorized that transaction.

It should not be treated as a permanent browser login session.

Separate:

```text
PAYMENT AUTHORIZATION
```

from:

```text
APPLICATION AUTHENTICATION
```

---

# 91. Testnet Development

Nimiq Pay provides a development network switch for Nimiq operations and allows developers to obtain testnet NIM for transaction testing.

All payment engineering should first be tested on:

```text
NIMIQ TESTNET
```

before mainnet.

---

# 92. Testnet/Mainnet Separation

Every purchase must know its network.

Conceptually:

```text
network = TESTNET
```

or:

```text
network = MAINNET
```

Never accept:

```text
testnet transaction
```

for:

```text
mainnet purchase
```

---

# 93. Environment Configuration

Example conceptual environments:

```text
development
→ testnet

staging
→ testnet

production
→ mainnet
```

Explicit overrides may exist for controlled testing.

Network selection must not come from an untrusted customer query parameter.

---

# 94. Backend RPC Environment

Backend verification must query a blockchain source for the correct network.

Conceptually:

```text
TESTNET PURCHASE
→ testnet RPC/client

MAINNET PURCHASE
→ mainnet RPC/client
```

Cross-network acceptance is forbidden.

---

# 95. RPC Reliability

The official Nimiq RPC API is intended for backend blockchain integrations.

Production architecture should nevertheless assume an RPC endpoint can temporarily fail.

Therefore:

```text
RPC unavailable
```

must usually mean:

```text
verification delayed
```

not:

```text
payment definitely failed
```

---

# 96. RPC Timeout

Example:

```text
wallet transaction submitted
        ↓
RPC timeout
```

Correct:

```text
Confirming your payment…
```

Incorrect:

```text
Payment failed.
Pay again.
```

The transaction may already exist.

---

# 97. Not Found Immediately

A newly submitted transaction may not be immediately discoverable through every verification path.

Therefore an initial:

```text
NOT_FOUND
```

does not necessarily mean:

```text
PERMANENT_FAILURE
```

until the reconciliation policy says the lookup window has expired.

---

# 98. Reconciliation Retry Policy

Verification retries should use controlled backoff.

Conceptually:

```text
verify

wait

verify again

wait longer

continue until terminal policy
```

Do not create an uncontrolled polling loop.

Exact timing belongs in architecture/configuration.

---

# 99. Final Verification Failure

Only after the reconciliation policy can establish that the transaction cannot validly settle the intent should the purchase move into an appropriate failure/rejection state.

Even then, preserve:

```text
intent

reported hash

verification history
```

for support/audit where appropriate.

---

# 100. User-Facing Payment States

Recommended UI states:

```text
Preparing payment…

Confirm in Nimiq Pay…

Transaction submitted…

Confirming payment…

Payment successful.

Payment cancelled.

Payment couldn't be completed.

Payment received — preparing your pass.

Still confirming your payment.
Do not pay again.
```

Avoid blockchain jargon where it does not help.

---

# 101. Never Show Raw RPC Errors

Bad:

```text
JSON-RPC -32000

TransactionNotFound

ConsensusError
```

Better:

```text
We're still confirming your payment.

Your transaction may already have been submitted.
Do not send another payment yet.
```

Technical error details belong in logs.

---

# 102. Competition Relevance

The Mini Apps Competition requires meaningful Nimiq Pay integration; logo placement alone does not qualify. Apps must use supported wallet/payment infrastructure as a core experience and be fully functional, not prototypes.

Nimpass payment is therefore intentionally central:

```text
without NIM payment

there is no purchased pass
```

That is strong product-level integration.

---

# 103. Competition Scoring Relevance

Current scoring assigns:

```text
45 points
Functionality, reliability and usefulness

25 points
Nimiq Pay and Nimiq integration

15 points
Real usage

10 points
Design and UX

5 points
Builder promotion
```

Payment reliability directly influences the two largest scoring areas.

---

# 104. Beyond Simple Payment

Competition FAQ states that use of NIM or the broader Nimiq ecosystem beyond merely accepting payment contributes additional value inside the integration category.

Nimpass naturally does more than checkout:

```text
NIM payment

wallet-derived pass ownership

wallet authorization

repeat pass usage

potential signed redemption authorization
```

This relationship should remain visible in the product.

---

# 105. Do Not Add Unrelated Crypto Features

Do not add:

```text
staking

swap

portfolio

block explorer

token charts
```

to increase apparent Nimiq integration.

They do not improve the Nimpass service-pass lifecycle.

Integration quality matters more than random API count.

---

# 106. Fully Functional Requirement

Competition rules require the submitted product to be usable on the first try and explicitly reject prototypes or mockups.

Therefore final submission must not contain:

```text
fake payment

mock tx hash

hardcoded success

demo-only provider

fake pass creation
```

The judging build must execute the real supported payment flow.

---

# 107. Secrets

Competition rules prohibit hardcoded private keys, API secrets or sensitive credentials in the repository.

The Nimiq Developer Center also warns that frontend bundles are visible to users and secrets must remain server-side.

Never store in frontend:

```text
RPC credentials

backend secrets

database password

JWT signing key

server signature key

private key

seed phrase
```

---

# 108. Client Configuration vs Secrets

Safe public configuration may include:

```text
API base URL

application origin

public network name
```

Secret material must remain backend-only.

Do not assume:

```text
.env
=
secret
```

when Vite injects a value into the browser bundle.

---

# 109. Payment Logging

Recommended structured internal events:

```text
purchase_intent_created

wallet_payment_requested

wallet_payment_cancelled

transaction_hash_received

transaction_verification_started

transaction_pending

transaction_confirmed

transaction_rejected

pass_creation_started

pass_created

purchase_completed

purchase_reconciliation_required
```

This makes failures diagnosable.

---

# 110. Sensitive Logging Rule

Never log:

```text
private key

seed phrase

wallet password

server secret

authentication credential
```

Use transaction identifiers and internal IDs only as permitted by privacy/security policy.

---

# 111. Purchase Audit Record

Nimpass should retain enough information to explain a purchase.

Conceptually:

```text
purchaseIntentId

passSnapshot

providerId

expectedRecipient

expectedValueLuna

paymentReference

network

transactionHash

actualSender

verificationStatus

createdAt

confirmedAt

passId
```

This provides operational traceability.

---

# 112. Transaction Hash Display

The customer may optionally be allowed to view:

```text
transaction hash
```

from purchase history.

But normal success UX should emphasize:

```text
Your pass is ready.

10 sessions remaining.
```

rather than blockchain internals.

---

# 113. Payment Receipt Model

Conceptually:

```text
Purchase successful

10 Personal Training Sessions

Alex Fitness

250 NIM

10 sessions available

[ View Pass ]
```

Additional technical detail can appear deeper.

---

# 114. Provider Changes Payout Wallet

Changing a provider's payout wallet only affects future purchase intents.

Existing purchase intent:

```text
recipient snapshot
=
old verified wallet
```

New purchase intent:

```text
recipient snapshot
=
new verified wallet
```

Do not mutate a payment already awaiting completion.

---

# 115. Provider Changes Price

Similarly:

```text
Purchase Intent A
250 NIM
```

must remain:

```text
250 NIM
```

even if provider changes Pass to:

```text
300 NIM
```

after Intent A was created.

Once Intent A expires, the customer must review current Pass terms to create a new purchase.

---

# 116. Provider Disables Pass Mid-Purchase

If a valid purchase intent already exists and the provider disables the Pass before payment:

the exact acceptance policy must be deterministic.

Initial Nimpass rule:

```text
A payment may only be initiated while
the purchase intent remains valid.
```

If the intent expires or becomes invalid before payment begins:

```text
return to current Pass state
```

Do not silently use stale purchase terms indefinitely.

---

# 117. Payment Arrives After Intent Expiration

This is a reconciliation edge case.

Because real funds may have moved:

```text
expired intent
+
matching on-chain payment
```

must not be discarded as though nothing happened.

It should enter:

```text
MANUAL_OR_AUTOMATED_RECONCILIATION
```

according to final policy.

Do not silently create or silently ignore economic value without a defined rule.

---

# 118. Client Cannot Decide Refund Policy

Frontend code must never implement logic such as:

```text
if payment amount wrong
send refund
```

Refunds are financial actions requiring a dedicated server/provider/security policy.

---

# 119. No Custodial Refund Assumption

Because NIM is paid directly to provider wallets, Nimpass cannot automatically assume it controls the funds for refunding.

Any future refund mechanism must account for provider authorization and actual fund custody.

---

# 120. Payment Integration Module

Nimiq frontend integration should be centralized.

Suggested conceptual structure:

```text
src/
  lib/
    nimiq/
      client.ts
      environment.ts
      payments.ts
      amounts.ts
      errors.ts
      deep-link.ts
```

Exact paths may differ.

Do not scatter raw provider calls throughout UI files.

---

# 121. `payments.ts` Responsibility

Conceptually:

```text
submitNimPayment(intent)

normalizePaymentError(error)

validateClientIntentShape(intent)
```

It may call:

```text
nimiq.sendBasicTransactionWithData()
```

but must not decide whether the payment is finally valid.

That remains server responsibility.

---

# 122. Backend Payment Service

Backend should maintain a payment/application service responsible for:

```text
create intent

persist snapshot

accept tx hash

query blockchain

verify transaction

reconcile status

complete purchase

create pass idempotently
```

This logic should not live directly inside HTTP/GraphQL resolver handlers.

---

# 123. Blockchain Adapter

Backend blockchain access should also be isolated.

Conceptually:

```text
NimiqBlockchainClient

getTransaction(hash)

getNetworkStatus()

normalizeTransaction()
```

Business logic should not depend directly on RPC response JSON structure everywhere.

---

# 124. Normalized Transaction Model

Backend may normalize Nimiq transaction information to:

```text
NimiqTransaction {
    hash
    sender
    recipient
    valueLuna
    state
    data
    network
    confirmations
}
```

Business verification operates on this normalized representation.

---

# 125. Payment Verification Function

Conceptually:

```text
verifyPayment(
    PurchaseIntent intent,
    NimiqTransaction tx
)
```

checks:

```text
hash

network

recipient

amount

reference

state

uniqueness
```

and returns a domain result.

---

# 126. Frontend Must Never Create Pass Directly

Forbidden flow:

```text
const txHash = await sendPayment()

localStorage.setItem("pass", ...)
```

A pass is a backend business entity.

The server creates it only after verified purchase conditions.

---

# 127. Local Storage Rule

Local storage may hold harmless temporary UX state.

It must not be the source of truth for:

```text
payment success

pass ownership

remaining sessions

purchase completion
```

Refreshing or clearing browser storage must not destroy legitimate purchases.

---

# 128. Payment Recovery Route

A purchase should have a recoverable application route or state.

Conceptually:

```text
/purchases/<id>
```

or equivalent internal route.

It may display:

```text
Confirming payment

Payment successful

Pass ready

Payment cancelled

Action required
```

Exact route design belongs in frontend architecture.

---

# 129. My Passes Is Recovery Too

Even if the customer never sees the final purchase-success screen:

```text
confirmed purchase
        ↓
pass created
```

must eventually appear in:

```text
My Passes
```

after authorization.

The success screen is not the only way to receive ownership.

---

# 130. Lost Client Callback

Critical scenario:

```text
payment succeeds

backend eventually verifies

browser closes before reporting result
```

Architecture should still be able to recover through:

```text
purchase reference

transaction discovery/reconciliation

stored intent state
```

where technically available.

The system must not depend solely on one fragile frontend callback.

---

# 131. Primary Transaction Correlation

Canonical correlation order:

```text
1. purchase intent reference in transaction data

2. submitted transaction hash

3. expected recipient

4. expected exact amount

5. transaction sender

6. network
```

This combination makes accidental or malicious cross-purchase matching much harder.

---

# 132. Server Trust Boundary

Never trust these client claims:

```text
payment successful

this is the sender

this is the amount

this is the recipient

this transaction is confirmed
```

Trust:

```text
server purchase snapshot

configured Nimiq network data

verified blockchain transaction

database constraints
```

---

# 133. Nimiq Pay Trust Boundary

Nimiq Pay safely mediates wallet actions, but it does not know Nimpass business rules.

Nimiq Pay does not decide:

```text
which Pass exists

how many sessions it contains

whether provider is active

whether pass should be created

whether transaction hash was reused
```

Nimpass must enforce these itself.

---

# 134. Blockchain Trust Boundary

Blockchain inclusion can establish facts such as:

```text
sender

recipient

value

transaction
```

It does not establish Nimpass concepts such as:

```text
Pass title

10 sessions

pass status

redemption history
```

Blockchain facts and application facts must be combined carefully.

---

# 135. Purchase Happy Path

Canonical flow:

```text
1. Customer opens Pass.

2. Nimpass displays:
   10 Personal Training Sessions
   250 NIM.

3. Customer chooses Buy Pass.

4. Backend validates Pass.

5. Backend creates purchase intent.

6. Intent snapshots:
   10 sessions
   25,000,000 Luna
   Alex's verified Nimiq address.

7. Nimiq provider initializes.

8. Nimpass requests a NIM transaction.

9. Nimiq Pay shows native confirmation.

10. Customer approves.

11. Nimiq Pay submits transaction.

12. Provider returns transaction hash.

13. Frontend associates hash with purchase intent.

14. Backend queries Nimiq network.

15. Backend verifies:
    network
    recipient
    amount
    purchase reference
    transaction state
    uniqueness.

16. Backend extracts transaction sender.

17. Payment becomes confirmed.

18. Backend atomically creates one pass.

19. Pass owner wallet = transaction sender.

20. Pass starts with:
    originalSessions = 10
    usedSessions = 0
    remainingSessions = 10.

21. Purchase becomes complete.

22. Customer sees:
    Payment successful.
    Your pass is ready.

23. Customer opens pass.
```

---

# 136. Cancellation Happy Path

```text
1. Customer chooses Buy Pass.

2. Purchase intent created.

3. Native Nimiq Pay confirmation opens.

4. Customer cancels.

5. Provider reports permission denial.

6. Nimpass maps to PAYMENT_CANCELLED.

7. No transaction hash is recorded as successful.

8. No active pass is created.

9. Customer may intentionally try again.
```

---

# 137. Pending Happy Path

```text
1. Wallet returns tx hash.

2. Backend queries transaction.

3. Transaction exists but is not yet sufficiently included.

4. Purchase status = VERIFYING.

5. UI shows:
   Confirming your payment…

6. Backend reconciles again.

7. Transaction becomes included.

8. Verification succeeds.

9. Pass created exactly once.

10. UI transitions to success.
```

---

# 138. Refresh Recovery Test

```text
Given

customer submitted payment

And

purchase = VERIFYING

When

customer refreshes Nimpass

Then

existing purchase is loaded

And

no second payment request starts

And

verification continues

And

eventual confirmed transaction creates one pass.
```

---

# 139. Duplicate Transaction Test

```text
Given

txHash X settled Purchase A

When

client submits txHash X for Purchase B

Then

Purchase B is rejected

And

no second pass is created.
```

---

# 140. Wrong Amount Test

```text
Given

expected = 25,000,000 Luna

When

transaction value = 20,000,000 Luna

Then

purchase does not become COMPLETE

And

no active pass is created

And

the payment enters reconciliation/error handling.
```

---

# 141. Wrong Recipient Test

```text
Given

expected recipient = Provider A

When

transaction recipient = Provider B

Then

purchase is not confirmed

And

no pass is created.
```

---

# 142. Wrong Reference Test

```text
Given

purchase intent reference = R1

When

transaction data = R2

Then

transaction cannot settle R1

even if amount and recipient happen to match.
```

---

# 143. Wrong Network Test

```text
Given

production purchase expects mainnet

When

submitted transaction exists only on testnet

Then

payment is invalid for that purchase

And

no production pass is created.
```

---

# 144. Pass Creation Idempotency Test

```text
Given

payment verification succeeds

When

completion handler runs twice concurrently

Then

database contains:

one purchase

one transaction mapping

one pass
```

---

# 145. Delayed Pass Test

```text
Given

payment is confirmed

When

pass creation temporarily fails

Then

customer is not asked to pay again

And

purchase remains recoverable

And

idempotent provisioning eventually creates one pass.
```

---

# 146. Test Matrix

Before production:

```text
TESTNET

payment approve

payment cancel

wrong recipient

wrong amount

wrong reference

pending transaction

included transaction

RPC timeout

RPC unavailable

refresh during wallet action

refresh during verification

double click

duplicate tx hash

concurrent completion

pass creation failure

provider changes Pass price

provider changes payout address

expired intent

browser → Nimiq Pay handoff

mobile Nimiq Pay WebView
```

---

# 147. Real Nimiq Pay Testing

Browser mocks alone are insufficient.

The Nimiq Developer Center describes loading a local application directly inside Nimiq Pay using a LAN-accessible development server and switching to Nimiq testnet for real wallet testing.

Critical payment behavior must be tested in actual Nimiq Pay.

---

# 148. Testnet NIM

Nimiq Pay provides free testnet NIM for development after switching to testnet.

Use testnet funds for:

```text
payment flow testing

wallet cancellation

transaction lookup

verification

reconciliation

pass creation
```

before mainnet.

---

# 149. Mainnet Readiness Gate

Do not enable production NIM payment until:

```text
price conversion tested

provider payout verification tested

purchase intent tested

transaction data tested

backend RPC verification tested

idempotency tested

duplicate transaction protection tested

network separation tested

wallet cancellation tested

pending transaction tested

reconciliation tested

pass creation tested

real Nimiq Pay mobile flow tested
```

---

# 150. Competition Readiness Gate

Before submission, verify:

```text
Nimiq Pay integration is real

NIM transaction is real

no mock payment path remains active

payment works inside Nimiq Pay

cancellation is understandable

failure is understandable

pending verification is recoverable

double payment is discouraged

duplicate purchase is prevented

pass creation is reliable

repository contains no secrets

product is usable on first try
```

These requirements directly support the competition's integration and functionality/reliability categories.

---

# 151. AI Coding Agent Rule — Official API

AI agents must not invent payment APIs.

Official Nimiq Mini App methods include:

```text
sendBasicTransaction()

sendBasicTransactionWithData()
```

The provider returns a transaction hash and requires native confirmation.

Do not invent:

```text
nimiq.pay()

nimiq.checkoutMiniApp()

nimiq.confirmPayment()

nimiq.createPassPayment()
```

unless future official documentation adds such methods.

---

# 152. AI Coding Agent Rule — No Frontend Trust

An AI agent must never implement:

```text
if (txHash) {
    createPass()
}
```

as the entire verification mechanism.

Correct:

```text
txHash
   ↓
backend blockchain verification
   ↓
domain validation
   ↓
atomic purchase completion
```

---

# 153. AI Coding Agent Rule — Do Not Use Floats

Forbidden:

```text
const price = 0.1 + 0.2
```

for authoritative NIM settlement calculations.

Use integer Luna internally.

---

# 154. AI Coding Agent Rule — Do Not Store Private Keys

No Nimpass code should:

```text
request

read

store

log

transmit
```

Nimiq private keys or seed phrases.

Nimiq Pay performs wallet cryptography.

---

# 155. AI Coding Agent Rule — No Fake Payment

Mock payment providers may exist in isolated development tests.

They must never accidentally remain enabled for:

```text
production

competition submission

real-user build
```

Production purchase creation must require the real configured Nimiq payment verification path.

---

# 156. AI Coding Agent Rule — Preserve Web-First Architecture

Do not turn the entire Nimpass application into:

```text
wallet initialization screen
```

Public web content loads independently.

Nimiq Pay functionality activates when required by the user journey.

---

# 157. AI Coding Agent Rule — Preserve Intent

When moving:

```text
browser
→
Nimiq Pay
```

preserve the Pass the user intended to purchase.

Never redirect a valid Pass intent to a generic landing page unless recovery requires it.

---

# 158. AI Coding Agent Rule — Uncertain ≠ Failed

This rule is mandatory.

```text
unknown payment result
```

must not automatically map to:

```text
FAILED
```

when the transaction may already have been submitted.

Use reconciliation.

---

# 159. AI Coding Agent Rule — Retrying Verification Is Safe

Safe retry:

```text
verify same purchase
```

Dangerous retry:

```text
send another payment
```

The UI and backend must preserve this distinction.

---

# 160. Nimpass Payment Invariants

The following statements must always remain true:

1. Pass price is authoritative on the server.

2. Provider payment recipient is authoritative on the server.

3. Prices are represented as integer Luna.

4. A purchase intent exists before a payment is treated as a Nimpass purchase.

5. The payment reference contains no personal data.

6. A wallet-returned transaction hash alone does not create an active pass.

7. Blockchain transaction details are verified server-side.

8. Recipient must match exactly.

9. Amount must match exactly.

10. Network must match.

11. Payment reference must match.

12. One transaction cannot settle multiple purchases.

13. One completed purchase cannot create multiple passes.

14. Transaction sender becomes the initial pass owner for MVP purchases.

15. Wallet cancellation creates no valid pass.

16. Pending payment creates no active pass.

17. Uncertain payment does not encourage immediate second payment.

18. Confirmed payment followed by provisioning failure does not request another payment.

19. Browser refresh does not create another purchase.

20. Client state is never the authoritative payment record.

21. Nimpass never receives private keys.

22. Production payment is tested inside real Nimiq Pay.

23. Mainnet and testnet are never mixed.

24. Existing purchases preserve their Pass snapshot.

25. Nimiq payment functionality remains central to the product rather than decorative.

---

# 161. Canonical Example

Use this scenario when explaining Nimpass payment architecture to a new developer or AI agent.

```text
Alex is a personal trainer.

Alex has previously verified his Nimiq payout wallet:

NQ-ALEX

Alex publishes:

10 Personal Training Sessions
250 NIM.

Emin opens the Pass.

Emin chooses:

Buy Pass.

Nimpass backend loads the Pass.

It confirms:

Pass is available

sessions = 10

price = 25,000,000 Luna

recipient = NQ-ALEX.

Backend creates Purchase Intent P1.

P1 contains an opaque payment reference.

Nimpass opens the Nimiq Pay payment flow.

Nimpass requests:

send 25,000,000 Luna

to NQ-ALEX

with P1's opaque reference.

Nimiq Pay shows native confirmation.

Emin approves.

Nimiq Pay signs and submits the transaction.

Nimpass receives transaction hash T1.

The frontend sends:

P1 + T1

to the backend.

The backend does NOT create a pass yet.

Backend queries the expected Nimiq network for T1.

Initially T1 may be pending.

Emin sees:

Confirming your payment…

When T1 becomes included, backend verifies:

T1 exists

T1 belongs to the correct network

T1 recipient = NQ-ALEX

T1 value = 25,000,000 Luna

T1 data contains P1's expected reference

T1 has never settled another Nimpass purchase.

The backend obtains T1's sender:

NQ-EMIN.

NQ-EMIN becomes the wallet owner of the new pass.

Inside one safe business transaction:

P1 is marked confirmed

T1 is permanently linked to P1

one pass is created

the pass receives:

original sessions = 10

used sessions = 0

remaining sessions = 10

status = ACTIVE

owner wallet = NQ-EMIN.

P1 becomes COMPLETE.

Emin sees:

Payment successful.

Your pass is ready.

Personal Training

10 sessions remaining.

If Emin reloads the page five times,
the same purchase still produces one pass.

If the server retries completion,
the same purchase still produces one pass.

If T1 is submitted again for another purchase,
it is rejected as already used.

One payment.

One purchase.

One pass.
```

---

# 162. Relationship to Other Documentation

```text
01-PRODUCT.md

Defines why NIM Pass purchasing exists.


02-USER-FLOWS.md

Defines what the customer sees while purchasing.


04-NIMIQ-MINI-APPS.md

Defines how Nimpass operates inside Nimiq Pay.


05-NIMIQ-PAY-INTEGRATION.md

Defines the actual payment protocol.


08-ARCHITECTURE.md

Defines concrete backend modules,
database schema,
APIs,
queues/jobs,
RPC client architecture.


09-SECURITY.md

Defines provider wallet verification,
wallet authentication,
signature challenges,
replay protection,
security boundaries,
abuse controls.


10-SUBMISSION-CHECKLIST.md

Verifies the production payment path
before competition submission.
```

---

# 163. Source Classification Rule

This file contains two types of statements.

## Nimiq Platform Facts

Examples:

```text
Mini Apps run inside Nimiq Pay.

The Nimiq provider is initialized using
@nimiq/mini-app-sdk.

sendBasicTransactionWithData exists.

Transaction values are expressed in Luna.

1 NIM = 100,000 Luna.

Provider calls require wallet confirmation
where documented.

RPC/Web Client APIs can query transactions.
```

These come from official Nimiq documentation.

## Nimpass Architecture Decisions

Examples:

```text
providers receive NIM directly

purchase intents are mandatory

transaction data carries an opaque reference

verified tx sender becomes pass owner

backend verifies recipient/value/reference

included transaction required for completion

pass creation is atomic and idempotent
```

These are deliberate Nimpass design decisions built on top of the Nimiq primitives.

AI agents must not confuse the two.

---

# 164. External Documentation Rule

Nimiq platform behavior may evolve.

Before implementing or modifying the payment integration:

```text
check current Nimiq Mini Apps documentation

check current Nimiq Provider API

check current RPC documentation

check current competition rules
```

Official current platform documentation overrides stale API assumptions.

Competition rules can also change between cycles.

---

# 165. Source-of-Truth Rule

When code conflicts with this document:

1. identify the conflict,
2. check whether current official Nimiq behavior changed,
3. determine whether this Nimpass architecture decision should change,
4. update this document explicitly,
5. only then modify the payment implementation.

Do not silently weaken payment verification because a simpler implementation is easier.

---

# 166. Final Payment Principle

The simplest safe mental model is:

```text
Nimiq Pay proves that
a wallet authorized a transaction.

The Nimiq blockchain proves
what transaction actually occurred.

The Nimpass backend proves
whether that transaction satisfies
a specific Nimpass purchase.

Only then does Nimpass create the pass.
```

Therefore:

```text
WALLET APPROVAL
≠
PASS

TRANSACTION HASH
≠
PASS

PENDING TRANSACTION
≠
PASS

CLIENT SUCCESS SCREEN
≠
PASS
```

The actual rule is:

```text
VERIFIED TRANSACTION
+
VALID PURCHASE INTENT
+
SERVER BUSINESS RULES
+
IDEMPOTENT PASS CREATION
=
ACTIVE NIMPASS
```

The final customer experience should still feel simple:

```text
Buy 10 sessions
      ↓
Pay 250 NIM
      ↓
Your pass is ready
      ↓
10 sessions remaining
```

All of the complexity in this document exists so that this simple experience can be trusted.
