# Nimpass — User Flows

> **Document type:** Product UX and interaction source of truth
> **Project:** Nimpass
> **Status:** Active
> **Audience:** Developers, AI coding agents, designers, product contributors
> **Depends on:** `01-PRODUCT.md`
> **Primary purpose:** Define how customers and service providers move through Nimpass across the web-first product experience, including discovery, package purchase, Nimiq Pay payment, pass ownership, session redemption, repeat usage, success states, failure states, recovery paths, and critical edge cases.

---

# 1. Purpose of This Document

`01-PRODUCT.md` defines **what Nimpass is**.

This document defines:

> **How people actually use Nimpass.**

It is the behavioral source of truth for user journeys.

Before implementing a page, route, component, modal, drawer, wallet interaction, payment state, pass interaction, provider workflow, or redemption workflow, the expected user journey should be understandable from this document.

Nimpass has two primary actors:

```text
CUSTOMER

discovers providers and services
buys multi-session packages
owns digital passes
tracks remaining sessions
redeems sessions over time
reviews usage history
buys again


PROVIDER

creates a public provider presence
creates services
creates multi-session packages
publishes and shares packages
receives customers
validates session usage
tracks active passes
continues the customer relationship
```

The central lifecycle is:

```text
Provider creates package
        ↓
Package becomes publicly accessible
        ↓
Customer discovers or receives package link
        ↓
Customer reviews package
        ↓
Customer purchases with NIM
        ↓
Nimiq Pay handles wallet/payment interaction
        ↓
Payment is verified
        ↓
Customer receives wallet-linked Nimpass
        ↓
Customer returns later
        ↓
Customer attends a session
        ↓
One session is securely redeemed
        ↓
Remaining sessions decrease by exactly one
        ↓
Customer returns again
        ↓
Process repeats
        ↓
Pass reaches zero
        ↓
Pass becomes completed
        ↓
Customer may buy the current package again
```

Every important user flow should strengthen this lifecycle.

---

# 2. Platform Model

Nimpass is **web-first**.

The canonical Nimpass experience is a responsive web application that users can open from a normal browser using a normal URL.

The web application is not merely a desktop administration panel.

It is the primary product surface.

Conceptually:

```text
NIMPASS WEB

Public discovery
Provider profiles
Package pages
Customer passes
Provider management
Purchase flow
History
Redemption
Sharing
```

Nimiq Pay and the Nimiq Mini App environment are important integrations, but they do not redefine Nimpass as a mobile-only product.

The correct relationship is:

```text
Nimpass
=
primary web product

Nimiq Pay
=
wallet + payment interaction layer

Nimiq Mini App environment
=
important mobile distribution and usage context
```

The implementation must therefore avoid assuming:

```text
Nimpass only exists inside Nimiq Pay.
```

That assumption is incorrect.

---

# 3. Web-First Does Not Mean Desktop-Only

Web-first means the main product architecture, navigation, public pages, provider management experience, URLs, and information architecture are designed around the web.

It does **not** mean mobile can be ignored.

The same product must remain responsive.

Important customer flows must work comfortably on:

```text
desktop browser
tablet browser
mobile browser
supported Nimiq Mini App context
```

Especially:

```text
open provider
open package
understand package
pay with NIM
view pass
see remaining sessions
generate redemption proof
review session history
buy again
```

Provider administration may use richer desktop layouts where appropriate.

Customer-critical actions must remain usable on smaller screens.

---

# 4. Product Surface Priority

Nimpass has three important experience surfaces.

```text
1. PUBLIC WEB EXPERIENCE

   discovery
   provider profiles
   package pages
   shared package links


2. CUSTOMER EXPERIENCE

   purchases
   passes
   remaining sessions
   redemption
   history
   repurchase


3. PROVIDER EXPERIENCE

   provider profile
   services
   packages
   active passes
   redemption validation
   operational history
```

The public web experience is particularly important because users should be able to understand Nimpass before being forced into wallet interaction.

---

# 5. Core UX Principle — Public First

A customer should be able to browse public Nimpass content without connecting a wallet immediately.

Preferred:

```text
Open Nimpass
      ↓
Browse
      ↓
Open provider
      ↓
Open package
      ↓
Understand offer
      ↓
Decide to purchase
      ↓
Wallet interaction becomes necessary
```

Avoid:

```text
Open Nimpass
      ↓
Connect wallet immediately
      ↓
User has not even seen the product yet
```

Wallet interaction must happen when it serves a real product action.

---

# 6. Core UX Principle — Preserve Direct Intent

Nimpass is URL-driven.

Public providers and packages should be directly addressable wherever possible.

Example:

```text
Provider shares package link
        ↓
Customer clicks link
        ↓
Nimpass opens directly on that package
```

Do not force:

```text
Package link
    ↓
Homepage
    ↓
Onboarding
    ↓
Discovery
    ↓
Search
    ↓
Package again
```

The destination encoded in a valid link should be respected.

---

# 7. Core UX Principle — Minimum Friction

Users should not complete unnecessary account setup merely to understand the product.

A preferred customer purchase journey is:

```text
Open package
      ↓
Understand package
      ↓
Buy Pass
      ↓
Required wallet interaction
      ↓
Payment
      ↓
Pass
```

Avoid unnecessary steps such as:

```text
username creation
password creation
profile completion
multi-screen onboarding
mandatory tutorial
irrelevant personal information
```

unless a step is required by the final authentication or security architecture.

---

# 8. Core UX Principle — Nimiq Should Feel Native

Users should not feel that they left Nimpass and entered an unrelated cryptocurrency workflow.

Nimiq functionality should feel like a natural part of purchasing and owning a pass.

Conceptually:

```text
Package
   ↓
Buy Pass
   ↓
Nimiq payment interaction
   ↓
Payment confirmation
   ↓
Nimpass
```

The user should understand:

```text
what they are buying
who they are paying
how much NIM they are paying
what happens after payment
```

before authorizing the transaction.

---

# 9. Core UX Principle — Never Hide State

Important actions must expose their state clearly.

Relevant states include:

```text
idle
preparing
awaiting user
processing
verifying
successful
cancelled
failed
uncertain
completed
```

The user must never be left asking:

```text
Did I pay?

Did the payment go through?

Was my pass created?

Did this session get consumed?

Should I try again?

How many sessions remain?
```

---

# 10. Core UX Principle — Backend State Is Authoritative

A visual transition does not prove that an important operation succeeded.

For example:

```text
Nimiq payment UI reports success
```

must not automatically mean:

```text
Nimpass pass is definitely active
```

when server-side confirmation is still required.

Similarly:

```text
Provider presses Confirm Session
```

must not immediately mean:

```text
session count decreased
```

unless the authoritative state change succeeded.

The UI may provide optimistic feedback only where it cannot create false ownership, payment, or redemption state.

---

# 11. Core UX Principle — One Clear Primary Action

Important surfaces should normally make the next action obvious.

Examples:

```text
Package

[ Buy Pass ]
```

```text
Active Pass

[ Use Session ]
```

```text
Completed Pass

[ Buy Again ]
```

```text
Provider package

[ Share Package ]
```

```text
Provider redemption

[ Confirm Session ]
```

Secondary actions must not compete visually with the main task.

---

# 12. Core UX Principle — Progressive Disclosure

Nimpass should show the information most useful to the current task first.

For example, a pass should emphasize:

```text
Personal Training

Alex Fitness

7 sessions remaining

[ Use Session ]
```

and not lead with:

```text
pass UUID
database ID
transaction hash
wallet implementation details
redemption nonce
internal status codes
```

Technical information may exist deeper in the interface where useful.

---

# 13. Core UX Principle — Repeated Use

Nimpass is not a one-time checkout experience.

The product must optimize for users returning days or weeks after the original purchase.

A successful customer relationship looks like:

```text
Purchase
   ↓
Leave
   ↓
Return
   ↓
Use session
   ↓
Leave
   ↓
Return
   ↓
Use session
   ↓
...
   ↓
Complete
   ↓
Buy again
```

Returning to an existing pass must therefore be extremely easy.

---

# 14. Actor Model

The two primary contexts are:

```text
┌─────────────────────────────┐
│          PROVIDER           │
│                             │
│ Creates public presence     │
│ Creates services            │
│ Creates packages            │
│ Receives NIM purchases      │
│ Validates sessions          │
└──────────────┬──────────────┘
               │
               │ package / pass
               ▼
┌─────────────────────────────┐
│          CUSTOMER           │
│                             │
│ Discovers provider          │
│ Purchases package           │
│ Owns pass                   │
│ Uses sessions over time     │
└─────────────────────────────┘
```

One person may participate in both roles.

Example:

```text
Alex sells personal-training packages
```

and also:

```text
Alex buys a language-learning package
```

In the second flow, Alex is acting as a customer.

The UI must maintain clear role context.

---

# 15. Top-Level Public Web Journey

A visitor may arrive without having used Nimpass before.

Canonical journey:

```text
Nimpass URL
     ↓
Public Home
     ↓
Discover
     ↓
Provider / Service
     ↓
Package
     ↓
Package Detail
     ↓
Buy Pass
```

The public experience should explain Nimpass through the product itself rather than through a long mandatory tutorial.

---

# 16. Top-Level Customer Journey

```text
ENTRY
  ↓
Discover or Open Direct Link
  ↓
Provider / Package
  ↓
Package Detail
  ↓
Buy Pass
  ↓
Nimiq Pay Interaction
  ↓
Payment Verification
  ↓
Pass Creation
  ↓
Purchase Success
  ↓
My Pass
  ↓
Return Later
  ↓
Use Session
  ↓
Secure Redemption
  ↓
Pass Updated
  ↓
Repeat
  ↓
Pass Completed
  ↓
Buy Again
```

The user must be able to leave and return without losing meaningful state.

---

# 17. Top-Level Provider Journey

```text
ENTRY
  ↓
Provider Workspace
  ↓
Create / Complete Provider Profile
  ↓
Create Service
  ↓
Create Package
  ↓
Preview
  ↓
Publish
  ↓
Share / Become Discoverable
  ↓
Customer Purchases
  ↓
Active Pass Created
  ↓
Customer Attends Session
  ↓
Validate Session
  ↓
One Session Consumed
  ↓
Pass Updated
  ↓
Repeat
  ↓
Pass Completed
```

Provider flows should be optimized primarily for the web application.

---

# 18. Customer Entry Points

A customer may enter through:

```text
Nimpass homepage

Discover page

Search result

Provider profile

Package detail page

Direct package link

Direct provider link

Shared social/message link

Package QR

Existing pass

My Passes

Nimiq Pay Mini App discovery

Previously opened Nimpass page
```

Each entry point should preserve context.

---

# 19. Public Homepage Flow

The homepage is a public web surface.

Its job is to quickly answer:

```text
What is Nimpass?

What can I find here?

What can I do next?
```

A conceptual flow:

```text
Home
 ↓
Understand proposition
 ↓
Browse services/providers
 ↓
Open interesting provider/package
```

The homepage should not become a blockchain landing page dominated by technical terminology.

---

# 20. Discovery Flow

Discovery exists to help users reach useful providers and packages.

Conceptually:

```text
Discover
   ↓
Browse providers / services
   ↓
Select result
   ↓
Provider or package
```

Discovery is useful, but it must not become the product itself.

Nimpass remains centered on:

```text
purchase
ownership
remaining sessions
redemption
repeat use
```

not endless feed consumption.

---

# 21. Search Flow

Where search is supported:

```text
User searches
      ↓
Relevant provider/service/package results
      ↓
User selects result
      ↓
Relevant detail page
```

Search should primarily help users find service offerings.

Nimpass must not turn into a generic cryptocurrency marketplace search engine.

---

# 22. Provider Public Profile

A provider has a public-facing page.

Example:

```text
Alex Fitness

Personal Trainer

Helping people build strength
through private training.

AVAILABLE PASSES

5 Personal Training Sessions
150 NIM

10 Personal Training Sessions
250 NIM

20 Personal Training Sessions
450 NIM
```

The page should answer:

```text
Who is this?

What do they offer?

What can I purchase?
```

The provider profile is not primarily a social-media profile.

Avoid making:

```text
followers
likes
public feed
social posting
comments
```

central to the experience.

---

# 23. Provider Profile → Package Flow

```text
Provider Profile
       ↓
Available Packages
       ↓
Select Package
       ↓
Package Detail
```

The transition should feel lightweight.

A customer should not need to open several unrelated pages before seeing the actual offer.

---

# 24. Package Detail

The package page is one of Nimpass's most important conversion surfaces.

The user should immediately understand:

```text
SERVICE

PROVIDER

SESSION COUNT

PRICE IN NIM

WHAT THE PACKAGE INCLUDES

WHAT HAPPENS AFTER PURCHASE
```

Example:

```text
10 Personal Training Sessions

Alex Fitness

10 private personal-training sessions.

10 sessions

250 NIM

After purchase, this package becomes
a digital Nimpass linked to your wallet.

[ Buy Pass ]
```

Optional secondary information may include:

```text
description
location
provider details
expiration
terms
```

where supported.

---

# 25. Package Availability States

## Available

```text
10 sessions

250 NIM

[ Buy Pass ]
```

## Temporarily unavailable

```text
10 sessions

250 NIM

Currently unavailable.
```

The purchase CTA must not appear usable.

## No longer offered

```text
This package is no longer available
for new purchases.
```

Previously purchased passes remain separate objects and must not disappear merely because the current package is unavailable.

---

# 26. Package Sharing

Public packages should be shareable.

Provider actions may include:

```text
Copy Link

Share

Show Package QR
```

The canonical shared destination is the package itself.

```text
Shared Package URL
        ↓
Package Detail
```

Do not redirect to the homepage unnecessarily.

---

# 27. Starting a Purchase

When the customer chooses:

```text
[ Buy Pass ]
```

Nimpass begins a purchase flow.

Conceptually:

```text
Package Detail
      ↓
Purchase Intent Created
      ↓
Required Wallet Context
      ↓
Nimiq Pay
```

Immediately before wallet approval, the customer should know:

```text
provider
package
session count
price
currency
```

---

# 28. Wallet Interaction Timing

Wallet interaction should be requested at the moment it becomes useful.

Preferred:

```text
Browse publicly
       ↓
Choose package
       ↓
Buy Pass
       ↓
Wallet interaction
```

Not:

```text
Open homepage
       ↓
Mandatory wallet connection
       ↓
Browse
```

The exact connection/session model belongs to the Nimiq integration documentation.

---

# 29. Payment State Model

Conceptually:

```text
NOT_STARTED
      ↓
PREPARING
      ↓
AWAITING_USER
      ↓
 ┌────┼──────────────┐
 ↓    ↓              ↓
SUCCESS CANCELLED   FAILED
 ↓
VERIFYING
 ↓
PASS_CREATING
 ↓
COMPLETE
```

A separate uncertain state may exist when the final outcome is not yet known.

---

# 30. Payment Preparing

Immediately after purchase begins:

```text
Preparing payment…
```

The purchase CTA must be protected against repeated accidental initiation.

Avoid:

```text
tap
tap
tap
tap
```

creating multiple purchase attempts.

---

# 31. Awaiting Nimiq Pay Approval

When wallet approval is required:

```text
Confirm your payment

10 Personal Training Sessions

250 NIM

Alex Fitness
```

The customer should understand:

```text
payment has not finished yet
pass does not exist yet
```

---

# 32. Payment Cancelled

User cancellation is not a system error.

Example:

```text
Payment cancelled

No completed purchase was created.

[ Try Again ]

[ Back to Package ]
```

Do not use alarming failure language for an intentional cancellation.

---

# 33. Payment Failure

Possible causes may include:

```text
insufficient balance
network failure
wallet failure
transaction rejection
integration failure
unexpected technical failure
```

User-facing example:

```text
Payment couldn't be completed.

Your pass was not created.

[ Try Again ]
```

When safely available:

```text
Insufficient NIM balance.
```

is preferable to:

```text
RPC_ERROR_-32001
```

Raw technical exceptions must not be exposed as primary UI.

---

# 34. Payment Result Uncertain

A critical scenario is:

```text
payment submitted
      ↓
connection interrupted
      ↓
Nimpass cannot yet determine outcome
```

Do not immediately say:

```text
Payment failed.
```

Instead:

```text
Confirming your payment…

Do not send another payment yet.
```

Nimpass should reconcile the authoritative payment state.

The purpose is to prevent:

```text
first payment succeeds
       +
customer thinks it failed
       +
customer pays again
```

---

# 35. Payment Verification

Payment completion and Nimpass purchase completion are separate concepts.

Conceptually:

```text
Nimiq payment result
       ↓
Nimpass verification
       ↓
purchase confirmed
       ↓
pass created
```

The application must not display final ownership until required verification is complete.

---

# 36. Payment Success

After payment and pass creation are confirmed:

```text
Payment successful

Your Nimpass is ready.

Personal Training

10 sessions remaining

[ View Pass ]
```

The transition to the newly created pass should be immediate and obvious.

---

# 37. Payment Succeeds but Pass Creation Is Delayed

Possible state:

```text
Payment confirmed
      ↓
Pass creation delayed
```

The UI should say:

```text
Payment received

We're preparing your pass.

You do not need to pay again.
```

The customer must not be asked to repeat the payment.

---

# 38. Duplicate Purchase Protection

The system must safely handle:

```text
double-click
double-tap
browser refresh
client retry
network retry
server retry
returning from wallet
```

One intended purchase must not accidentally create multiple valid purchases.

Idempotency is a product requirement.

---

# 39. Purchase Recovery After Closing the Browser

Example:

```text
payment submitted
      ↓
browser closed
      ↓
user returns later
```

Nimpass must recover the authoritative state.

Possible results:

```text
payment never occurred

payment cancelled

payment failed

payment confirmed

payment still reconciling

pass already created
```

The application must not blindly start another payment.

---

# 40. Customer Pass Creation

A confirmed purchase produces a customer-specific digital pass.

The pass represents:

```text
purchased service entitlement
+
wallet-linked ownership
+
remaining session state
+
usage history
```

The pass is not merely a receipt.

It remains useful after the transaction.

---

# 41. First Pass View

Example:

```text
┌───────────────────────────────────┐
│ Personal Training                 │
│                                   │
│ Alex Fitness                      │
│                                   │
│              10                   │
│       sessions remaining          │
│                                   │
│          0 of 10 used             │
│                                   │
│       [ Use Session ]             │
│                                   │
│          View History             │
└───────────────────────────────────┘
```

The hierarchy must emphasize:

```text
service
provider
remaining sessions
primary action
```

---

# 42. My Passes

Returning customers require a predictable place for all purchased passes.

Conceptually:

```text
My Passes
```

Useful organization:

```text
ACTIVE

Personal Training
Alex Fitness
7 sessions remaining

English Lessons
Sarah
3 sessions remaining


COMPLETED

Career Coaching
5 of 5 used
```

Active passes should normally be easier to reach than historical passes.

---

# 43. My Passes Empty State

Example:

```text
No passes yet.

Packages you purchase will appear here.

[ Discover Services ]
```

The empty state should lead naturally back into the product.

---

# 44. Returning Customer Home

A customer with active passes should not return to a generic marketing experience every time.

Preferred:

```text
Welcome back

YOUR PASSES

Personal Training
7 remaining

English Lessons
3 remaining

[ Discover More ]
```

The product should remember that this user already has ongoing service relationships.

---

# 45. Pass Detail

An active pass should clearly display:

```text
service
provider
original session quantity
sessions used
sessions remaining
status
primary redemption action
history access
```

Example:

```text
Personal Training

Alex Fitness

7 sessions remaining

3 of 10 used

[ Use Session ]

View History
```

---

# 46. Starting Session Redemption

The customer chooses:

```text
[ Use Session ]
```

This begins a controlled process.

Conceptually:

```text
Active Pass
      ↓
Create fresh redemption challenge
      ↓
Present proof
      ↓
Provider validates
      ↓
Required authorization checked
      ↓
Backend verifies pass
      ↓
Consume exactly one session
      ↓
Both sides receive confirmed result
```

---

# 47. Redemption Security Principle

A screenshot or copied QR must not function as permanent ownership proof.

The system must distinguish:

```text
someone can see a code
```

from:

```text
someone owns and is authorized to use the pass
```

The technical architecture may combine:

```text
short-lived QR
one-time challenge
wallet-linked authorization
server-side verification
provider confirmation
```

The exact cryptographic mechanism belongs in `09-SECURITY.md`.

This document defines the required user behavior.

---

# 48. Customer Redemption Screen

A conceptual customer view:

```text
Use a Session

Show this code to Alex Fitness.

[ QR ]

Expires in 01:32

Personal Training

7 sessions remaining

[ Cancel ]
```

The customer must understand that:

```text
displaying the code
≠
session already consumed
```

---

# 49. Provider Redemption Entry

The provider must have a quickly reachable validation action.

For example:

```text
Provider Workspace

[ Scan Session ]

Active Passes

Packages

Recent Activity
```

Redemption should not be hidden several layers deep inside provider settings.

---

# 50. Provider Opens Scanner

Conceptually:

```text
Provider Workspace
       ↓
Scan Session
       ↓
Camera / supported scan interaction
       ↓
Customer redemption challenge
```

On devices where camera scanning is supported, the flow should be direct.

The scanner is an operational tool, not a discovery feature.

---

# 51. Provider Scans Valid Challenge

Flow:

```text
Scan QR
   ↓
Validate challenge
   ↓
Load relevant pass state
   ↓
Show human-readable summary
   ↓
Provider confirms
   ↓
Consume session
   ↓
Success
```

The provider should understand exactly what is about to happen.

---

# 52. Provider Confirmation

Good:

```text
Personal Training

7 sessions remaining

Use one session?

After:
6 sessions remaining

[ Confirm Session ]
```

Avoid:

```text
Pass ID: 01JF83J...
Wallet: NQ12...
Nonce: ...
Challenge hash: ...
```

Technical identifiers must not replace human-readable confirmation.

---

# 53. Redemption Processing

After provider confirmation:

```text
Using session…
```

During processing:

```text
confirmation button disabled
duplicate submission prevented
current state preserved
```

The UI must not encourage another scan while the result is unresolved.

---

# 54. Redemption Success — Provider

Example:

```text
Session completed

Personal Training

6 sessions remaining

[ Done ]
```

The provider should immediately understand the resulting balance.

---

# 55. Redemption Success — Customer

The customer pass updates from:

```text
7 sessions remaining
3 of 10 used
```

to:

```text
6 sessions remaining
4 of 10 used
```

A lightweight confirmation may appear:

```text
Session used

6 sessions remaining.
```

---

# 56. QR Expiration

If a temporary redemption challenge expires:

```text
This code expired.

No session was used.

[ Generate New Code ]
```

Expiration alone must never consume a session.

---

# 57. QR Already Used

If the same successful challenge is presented again:

```text
This session code has already been used.
```

The system must not consume another session.

The authoritative current pass count should be returned where appropriate.

---

# 58. Invalid Redemption Challenge

Provider-facing example:

```text
Invalid session code.

Ask the customer to generate a new code.
```

Do not expose raw parsing, signature, or cryptographic errors.

---

# 59. Unauthorized Wallet

If the current wallet is not authorized for the pass:

```text
This pass belongs to a different wallet context.

Use the wallet that owns this pass.
```

The application must avoid exposing private information about the actual owner unnecessarily.

---

# 60. Pass With Zero Sessions

If:

```text
remainingSessions = 0
```

redemption cannot begin.

Customer:

```text
Pass completed

All 10 sessions have been used.

[ Buy Again ]
```

Provider:

```text
This pass has no sessions remaining.
```

No state mutation occurs.

---

# 61. Expired Pass

Where expiration is supported:

Customer:

```text
Pass expired

This pass expired on September 1.

3 unused sessions remain.
```

Standard redemption is disabled.

Provider:

```text
This pass has expired.

A session cannot be redeemed.
```

Extension or override behavior must not be invented without an explicit product decision.

---

# 62. Cancelled Pass

Where cancellation exists:

```text
Pass cancelled

This pass can no longer be used.
```

Previous history remains accessible where appropriate.

Cancellation must not silently erase the usage history.

---

# 63. Redemption Network Failure Before Processing

When Nimpass knows the server did not accept the redemption:

```text
Couldn't verify the session.

No session was marked as used.

[ Try Again ]
```

Only claim that no session was consumed when that fact is authoritative.

---

# 64. Redemption Result Uncertain

Critical scenario:

```text
provider confirms session
       ↓
server may process request
       ↓
connection disappears
```

Do not blindly create a new redemption.

Instead:

```text
Checking session status…
```

The application should reconcile using the existing redemption identity.

Desired behavior:

```text
first request succeeds
      ↓
connection drops
      ↓
same logical operation retried
      ↓
server recognizes it
      ↓
returns original success

NOT

consume another session
```

---

# 65. Duplicate Redemption Protection

The following may all belong to the same logical redemption:

```text
double-click
double-tap
same QR rescanned
browser refresh
client retry
network retry
server retry
same request resent
```

Correct:

```text
7 → 6
```

Incorrect:

```text
7 → 6 → 5
```

A single intended session usage must consume exactly one session.

---

# 66. Session History

Successful confirmed redemptions create history entries.

Example:

```text
Session History

Sep 12
Session used
7 → 6 remaining

Sep 5
Session used
8 → 7 remaining

Aug 29
Pass purchased
10 sessions available
```

History should represent authoritative state changes.

---

# 67. Provider Operational History

A provider may see relevant events such as:

```text
package purchase
session redeemed
pass completed
```

Example:

```text
Recent Activity

Today
Personal Training
Session redeemed
6 remaining

Yesterday
English Lessons
Pass purchased
10 sessions
```

This is operational history.

It must not become an invasive customer surveillance system.

---

# 68. Final Session

Before:

```text
1 session remaining
```

Successful redemption:

```text
1 → 0
```

The pass then becomes:

```text
Completed

10 of 10 sessions used.
```

The active redemption CTA disappears.

---

# 69. Completed Pass

Example:

```text
Personal Training

Completed

10 of 10 sessions used

[ Buy Again ]

View History
```

Completed passes remain accessible.

A completed pass is part of the user's history, not disposable temporary UI.

---

# 70. Buy Again

The repurchase flow is:

```text
Completed Pass
      ↓
Buy Again
      ↓
Current Package
      ↓
Review Current Terms
      ↓
Purchase
```

Nimpass must not silently repurchase using historical terms.

If the provider changed:

```text
price
session quantity
expiration
description
availability
```

the customer sees the current offer before paying.

---

# 71. Existing Passes and Package Changes

A package is the current offer.

A pass is the historical purchased entitlement.

These must remain separate.

Example:

```text
Customer bought:

10 sessions
250 NIM
```

Later the provider changes the package to:

```text
8 sessions
220 NIM
```

The customer's existing pass remains:

```text
10 original sessions
```

New customers purchase the updated package.

---

# 72. Provider Disables a Package

Flow:

```text
Provider disables package
        ↓
New purchases blocked
```

Existing legitimate passes do not automatically disappear.

Do not confuse:

```text
PACKAGE AVAILABILITY
```

with:

```text
PASS VALIDITY
```

---

# 73. Provider First-Time Setup

A new provider should reach a sellable package quickly.

Preferred:

```text
Provider Workspace
       ↓
Create Provider Profile
       ↓
Create Service
       ↓
Create Package
       ↓
Preview
       ↓
Publish
       ↓
Share
```

Avoid requiring a massive business-management setup before the first package can be published.

---

# 74. Provider Profile Creation

Provider information may include:

```text
provider name
profile image
professional category
short description
public information
```

Example:

```text
Alex Fitness

Personal Trainer

Private strength and conditioning sessions.
```

The provider profile should create enough trust to understand who is selling the service.

---

# 75. Create Service

A service represents the underlying activity.

Example:

```text
Personal Training

Private one-to-one training sessions.
```

Flow:

```text
Provider Workspace
       ↓
Services
       ↓
Create Service
```

Creating a service does not automatically create a purchasable package.

---

# 76. Create Package

From a service:

```text
Personal Training
       ↓
Create Package
```

Core package fields include:

```text
package title
number of sessions
price in NIM
description
optional expiration
```

Example:

```text
10 Personal Training Sessions

Sessions
10

Price
250 NIM

Description
Ten private personal-training sessions.
```

---

# 77. Package Validation

Invalid examples:

```text
0 sessions

negative session count

negative price

missing required title

invalid numeric value
```

Feedback should be human-readable.

Good:

```text
Session count must be at least 1.
```

Bad:

```text
VALIDATION_ERROR_FIELD_003
```

---

# 78. Package Preview

Before publication:

```text
Package Editor
      ↓
Preview
      ↓
Publish
```

Preview should resemble the customer-facing offer closely enough that the provider understands what will be published.

---

# 79. Publish Package

Successful publication:

```text
Package published

Your 10-session Personal Training package
is ready.

[ View Package ]

[ Share Package ]
```

The resulting package has a stable public destination where supported.

---

# 80. Provider Packages

Provider package management may distinguish:

```text
ACTIVE

10 Personal Training Sessions
250 NIM

5 Personal Training Sessions
150 NIM


UNAVAILABLE

20 Personal Training Sessions
450 NIM
```

This status refers to availability for new purchases.

It does not automatically invalidate previously sold passes.

---

# 81. Provider Active Passes

A provider may need to understand active customer entitlements.

Conceptually:

```text
Active Passes

Personal Training

10-session package

Customer
7 remaining

Customer
2 remaining
```

Only information necessary for service delivery and pass management should be exposed.

---

# 82. Provider Pass Search

Where the provider has many customers, useful mechanisms may include:

```text
scan customer QR
search active passes
recent redemptions
recent customers
```

However, the primary in-person flow should favor customer-presented verification over manually searching through a large customer database.

---

# 83. Provider Workspace

The provider's main web experience should prioritize useful operational actions.

Example:

```text
Provider Overview

[ Scan Session ]

Active Passes
18

Published Packages
3

Recent Activity
...
```

The provider dashboard should support real work.

Avoid prioritizing vanity metrics over:

```text
selling
serving
validating
tracking
```

---

# 84. Web/Desktop Provider Priority

Provider workflows often involve:

```text
editing
forms
package management
pass lists
history
multiple pieces of information
```

These flows may use richer desktop layouts.

Examples include:

```text
side navigation
split layouts
tables where appropriate
multi-column package editors
larger previews
dashboard cards
```

This is acceptable.

The provider experience must not be artificially constrained to a mobile-only layout.

---

# 85. Responsive Provider Access

Web-first provider design does not prohibit mobile access.

Critical operational actions such as:

```text
scan session
confirm redemption
view pass status
view package
```

should remain responsive where practical.

More complex administration can remain optimized for larger screens.

---

# 86. Customer Navigation Model

A simple customer-facing navigation may conceptually include:

```text
Discover

My Passes
```

with contextual access to:

```text
Provider

Package

Pass

History
```

The exact visual navigation belongs in `03-DESIGN-SYSTEM.md`.

The information architecture should remain lightweight.

---

# 87. Provider Navigation Model

Provider web navigation may conceptually include:

```text
Overview

Services

Packages

Passes

Activity
```

with a highly visible:

```text
Scan Session
```

action.

The scanner does not need to be a permanent navigation section if a stronger interaction pattern exists, but it must remain quickly accessible.

---

# 88. Customer / Provider Context Switching

If one wallet can act as both provider and customer, context must remain explicit.

Avoid ambiguous interfaces where the user cannot tell whether they are:

```text
managing their business
```

or:

```text
using their own purchased passes
```

Potential entry points may clearly distinguish:

```text
My Passes

Provider Workspace
```

The design document defines the final presentation.

---

# 89. Deep Links

Public package:

```text
URL
 ↓
Package
```

Public provider:

```text
URL
 ↓
Provider
```

Owned pass:

```text
URL
 ↓
authorization check
 ↓
Pass
```

Provider management route:

```text
URL
 ↓
authorization check
 ↓
Provider Workspace
```

Unauthorized private routes must not leak protected information.

---

# 90. Invalid Private Pass Access

If a user opens a pass they do not own:

```text
Pass unavailable

You don't have access to this pass.
```

Do not reveal unnecessary information about:

```text
owner
session count
purchase
history
provider relationship
```

---

# 91. Wallet Change

If the active wallet context changes:

```text
Wallet A
   ↓
Wallet B
```

authorization-sensitive state must be refreshed.

Nimpass must not continue displaying Wallet A's private pass information solely because it was previously cached.

---

# 92. Provider Wallet Change

If provider authority depends on wallet identity, changing wallets requires provider permissions to be re-evaluated.

Do not assume:

```text
same browser
=
same authorization forever
```

The exact authorization model belongs in the security documentation.

---

# 93. Browser Refresh

Refreshing during critical operations must not create duplicate economic state.

Payment example:

```text
VERIFYING PAYMENT
      ↓
refresh
      ↓
recover existing purchase attempt
```

Redemption example:

```text
PROCESSING REDEMPTION
      ↓
refresh
      ↓
recover existing redemption
```

Never interpret refresh as permission to start another critical action.

---

# 94. Multiple Tabs

Because Nimpass is web-first, multiple browser tabs are a realistic scenario.

Example:

```text
Pass open in Tab A
Pass open in Tab B
```

A session is redeemed in Tab A.

Tab B may temporarily display stale information.

Before sensitive actions, Nimpass must validate authoritative state.

A stale tab must not allow:

```text
6 remaining
```

to incorrectly behave as:

```text
7 remaining
```

during redemption.

---

# 95. Browser Back Navigation During Purchase

If the customer navigates away from an active payment flow, returning must recover the existing state.

Possible results:

```text
not started

awaiting approval

cancelled

failed

confirmed

verifying

pass created
```

Back navigation must not silently create another purchase.

---

# 96. Browser Back Navigation During Redemption

Opening the redemption screen does not consume a session.

If the customer leaves before successful redemption:

```text
challenge may remain valid temporarily
```

or:

```text
challenge may be invalidated
```

according to the security architecture.

In either case:

```text
opening QR screen
≠
using session
```

---

# 97. Loading States

Important asynchronous operations require explicit feedback.

Examples:

```text
Loading providers…

Loading packages…

Loading your passes…

Preparing payment…

Waiting for payment approval…

Confirming payment…

Creating your pass…

Generating session code…

Verifying session…

Updating pass…
```

Critical operations must never present a blank screen as their only state.

---

# 98. Empty States

Customer:

```text
No passes yet.

Purchased session packages will appear here.

[ Discover Services ]
```

Provider packages:

```text
No packages yet.

Create your first session package.

[ Create Package ]
```

Provider active passes:

```text
No active passes yet.

Purchased passes will appear here.
```

Empty states should explain the next useful action.

---

# 99. Error States

A useful error communicates:

```text
what happened

what it means

what the user can do
```

Example:

```text
Couldn't load your passes.

Check your connection and try again.

[ Retry ]
```

Avoid generic:

```text
Something went wrong.
```

when a more useful explanation is safely available.

---

# 100. Offline Behavior

Nimpass must not pretend that server-backed economic actions completed while offline.

Critical online operations include:

```text
payment
payment verification
pass creation
redemption
authorization-sensitive refresh
```

Cached information may be displayed carefully.

If pass data may be stale:

```text
You're offline.

Some pass information may be out of date.
```

Do not represent cached remaining-session values as guaranteed authoritative state.

---

# 101. Provider Becomes Unavailable

If a provider public profile becomes unavailable, previously purchased customer history should not silently disappear.

Possible customer state:

```text
Provider unavailable

Your existing pass information remains available.
```

Rules governing whether remaining sessions can still be serviced must be defined separately.

Do not invent those rules inside the UI.

---

# 102. Package Price Change

Example:

```text
Yesterday

10 sessions
250 NIM


Today

10 sessions
300 NIM
```

Existing purchased pass:

```text
unchanged
```

New purchase:

```text
300 NIM
```

`Buy Again` leads to the current package before payment.

---

# 103. Package Session Quantity Change

Example:

```text
Old package
10 sessions

New package
8 sessions
```

A previously purchased 10-session pass remains a 10-session pass.

The package definition must never retroactively mutate the customer's purchased entitlement.

---

# 104. Public Package Removed

If the provider removes a package from discovery:

```text
new users can no longer purchase it
```

but:

```text
existing passes remain independent
```

unless a separately approved product rule explicitly changes pass validity.

---

# 105. Accessibility

Critical information must not rely solely on:

```text
color
animation
icon
```

Bad:

```text
green dot
```

Good:

```text
✓ Payment successful
```

Bad:

```text
red dot
```

Good:

```text
Payment failed
```

Remaining sessions must always be available as text.

Interactive controls must have usable touch targets on mobile.

---

# 106. Motion and Transition Philosophy

Nimpass should feel modern, calm, and lightweight.

Transitions may help users understand context.

However, animation must never obscure important states around:

```text
payment
wallet authorization
pass creation
redemption
```

Clarity has priority over spectacle.

---

# 107. Public Web Experience Philosophy

The public-facing flow should feel:

```text
simple
editorial
spacious
content-first
easy to scan
easy to share
low-friction
```

Users should be able to move naturally from:

```text
discovery
→ provider
→ package
→ purchase
```

without feeling like they entered a complex enterprise dashboard.

The visual direction is defined separately in `03-DESIGN-SYSTEM.md`.

---

# 108. Luma-Inspired Interaction Principle

Nimpass may take interaction inspiration from products such as Luma in areas such as:

```text
clean public pages
clear hierarchy
strong primary actions
shareable URLs
minimal onboarding
focused detail pages
comfortable whitespace
smooth discovery-to-detail transitions
```

This is an interaction and product-design reference.

Nimpass must not copy Luma's event-ticketing product model.

Nimpass remains a multi-session service-pass product.

---

# 109. Nimiq Pay Entry Flow

A user may discover Nimpass from within a Nimiq ecosystem surface.

Conceptually:

```text
Nimiq Pay / Mini App discovery
        ↓
Nimpass
        ↓
relevant responsive experience
```

The user should still encounter the same Nimpass product model.

Nimpass must not maintain one completely different conceptual product for browser users and another for Mini App users.

---

# 110. Mobile Mini App Customer Flow

On mobile, the customer journey should remain concise:

```text
Open Nimpass
      ↓
Open package
      ↓
Buy Pass
      ↓
Approve NIM payment
      ↓
View Pass
```

Later:

```text
Open Nimpass
      ↓
My Passes
      ↓
Pass
      ↓
Use Session
      ↓
Present QR
```

These flows are especially important for competition quality and real-world repeated usage.

---

# 111. Cross-Device Scenario

A realistic flow may involve:

```text
Provider:
desktop / tablet / phone

Customer:
phone
```

For example:

```text
Provider manages packages on desktop

Customer buys from phone

Customer later presents pass from phone

Provider validates using a supported device
```

The product architecture must not assume both participants use the same device type.

---

# 112. Customer Happy Path

Canonical scenario:

```text
1. Customer opens Nimpass on the web.

2. Customer discovers Alex Fitness.

3. Customer opens Alex's provider page.

4. Customer sees:
   10 Personal Training Sessions
   250 NIM.

5. Customer opens the package.

6. Customer understands:
   provider,
   service,
   session quantity,
   price.

7. Customer chooses Buy Pass.

8. Required Nimiq Pay interaction begins.

9. Customer approves 250 NIM payment.

10. Nimpass verifies the payment.

11. Nimpass creates a customer-specific pass.

12. Customer sees:
    Personal Training
    10 sessions remaining.

13. Customer leaves Nimpass.

14. One week later the customer returns.

15. My Passes shows Personal Training immediately.

16. Customer opens the pass.

17. Customer sees:
    10 sessions remaining.

18. Customer attends a real session.

19. Customer chooses Use Session.

20. Nimpass creates a short-lived redemption challenge.

21. Provider validates it.

22. Nimpass verifies:
    challenge validity,
    pass status,
    remaining sessions,
    authorization,
    duplicate usage protection.

23. Exactly one session is consumed.

24. Customer sees:
    9 sessions remaining.

25. Provider sees:
    Session completed
    9 sessions remaining.

26. The process repeats over time.

27. The final session is redeemed.

28. Pass becomes:
    Completed
    10 of 10 used.

29. Customer can review history.

30. Customer chooses Buy Again.

31. Nimpass opens the current package terms.

32. Customer may purchase another pass.
```

This lifecycle is the core Nimpass experience.

---

# 113. Provider Happy Path

```text
1. Provider opens the Nimpass web application.

2. Provider enters Provider Workspace.

3. Provider creates public profile:
   Alex Fitness
   Personal Trainer.

4. Provider creates service:
   Personal Training.

5. Provider creates package:
   10 Personal Training Sessions
   250 NIM.

6. Provider previews the customer-facing package.

7. Provider publishes it.

8. Package receives a public destination.

9. Provider shares package link.

10. Customer opens the link.

11. Customer purchases using NIM.

12. Payment is verified.

13. Active customer pass is created.

14. Customer attends a session.

15. Provider opens Scan Session.

16. Provider scans / validates the customer challenge.

17. Provider sees:
    Personal Training
    10 sessions remaining
    Use one session?

18. Provider confirms.

19. Pass changes:
    10 → 9.

20. Provider continues servicing the customer.

21. Each future session consumes exactly one unit.

22. Final session is consumed.

23. Pass becomes completed.

24. Customer may purchase another current package.
```

---

# 114. Public-Link Happy Path

Nimpass should also support a journey with almost no discovery.

```text
Alex sends package link in WhatsApp
        ↓
Customer opens link
        ↓
10 Personal Training Sessions
        ↓
Customer understands offer
        ↓
Buy Pass
        ↓
NIM payment
        ↓
Pass
```

This flow is important for providers who already acquire customers elsewhere.

Nimpass does not need to own every stage of customer acquisition.

---

# 115. Repeat-Use Happy Path

The repeated-use experience should be shorter than the first purchase.

```text
Open Nimpass
     ↓
My Passes
     ↓
Personal Training
     ↓
7 sessions remaining
     ↓
Use Session
```

A returning user must not repeat:

```text
discovery
provider research
package research
purchase
```

to use something they already own.

---

# 116. Critical Failure Matrix

| Scenario                                      | Expected outcome                                   |
| --------------------------------------------- | -------------------------------------------------- |
| Customer cancels payment                      | No new active pass; retry is available             |
| Payment fails                                 | No new active pass; useful error shown             |
| Payment result uncertain                      | Reconcile; do not encourage second payment         |
| Browser closes after payment                  | Existing purchase state is recoverable             |
| Payment succeeds but pass creation is delayed | Never request another payment                      |
| Buy button clicked repeatedly                 | One intended purchase remains one logical purchase |
| Temporary QR expires                          | No session consumed                                |
| Same QR scanned twice                         | Maximum one session consumed                       |
| Confirm Session clicked twice                 | Maximum one session consumed                       |
| Network drops after redemption request        | Reconcile existing redemption                      |
| Browser refreshes during redemption           | No duplicate session usage                         |
| Two tabs show same pass                       | Sensitive actions re-check authoritative state     |
| Pass has zero sessions                        | Redemption blocked                                 |
| Pass expired                                  | Redemption blocked                                 |
| Wrong wallet opens private pass               | Protected state not exposed                        |
| Provider disables package                     | Existing pass remains separate                     |
| Package price changes                         | Existing purchased terms unchanged                 |
| Package session quantity changes              | Existing pass quantity unchanged                   |
| User switches wallet                          | Private wallet state refreshed                     |
| Provider authorization changes                | Provider access re-evaluated                       |
| Cached data is stale                          | Sensitive operations rely on authoritative state   |

These are product requirements, not optional polish.

---

# 117. Purchase State Model

```text
PACKAGE_AVAILABLE
      ↓
PURCHASE_STARTED
      ↓
PAYMENT_PREPARING
      ↓
PAYMENT_PENDING
   ┌──┼───────────────┐
   ↓  ↓               ↓
FAILED CANCELLED   PAYMENT_CONFIRMED
                       ↓
                  VERIFYING
                       ↓
                  PASS_CREATING
                       ↓
                   PASS_ACTIVE
```

Possible separate state:

```text
PAYMENT_UNCERTAIN
```

must resolve before another payment is encouraged.

---

# 118. Pass State Model

Conceptually:

```text
PENDING
   ↓
ACTIVE
   │
   ├──────────────► EXPIRED
   │
   ├──────────────► CANCELLED
   │
   ↓
remaining = 0
   ↓
COMPLETED
```

Not every deployment must implement every optional state immediately.

The implementation must not invent incompatible lifecycle behavior.

---

# 119. Redemption State Model

```text
CREATED
   ↓
PRESENTED
   ↓
VALIDATING
   ↓
AUTHORIZED
   ↓
PROCESSING
   ↓
SUCCEEDED
```

Alternative endings may include:

```text
EXPIRED

CANCELLED

REJECTED

INVALID

FAILED
```

A successful redemption is final.

Repeated requests referring to the same logical successful redemption must return the existing result rather than consume another session.

---

# 120. Data Freshness Principle

Public content such as:

```text
provider description
package description
```

may tolerate ordinary web caching where appropriate.

Economic state such as:

```text
payment result
pass ownership
remaining sessions
redemption state
```

requires stronger freshness guarantees.

The UI must reflect this distinction.

---

# 121. Customer Priority Levels

## P0 — Must Work Exceptionally Well

```text
open Nimpass on web
open package directly
understand offer
pay with NIM
receive pass
find pass later
see remaining sessions
redeem one session
prevent duplicate usage
complete pass
buy again
```

## P1 — Important

```text
discovery
provider pages
search
package sharing
history
provider package management
active-pass management
responsive Mini App experience
clear loading / error / empty states
```

## P2 — Future / Secondary

```text
advanced recommendations
social features
complex analytics
calendar integration
promotions
provider teams
advanced CRM
loyalty mechanics
recurring automatic subscriptions
```

P2 work must never destabilize P0.

---

# 122. Provider Priority Levels

## P0

```text
create provider presence
create service
create package
set session quantity
set NIM price
publish
share
see active pass
validate one session
prevent duplicate redemption
```

## P1

```text
package editing
package availability
activity
pass search
package preview
better public profile management
```

## P2

```text
advanced analytics
team permissions
CRM functionality
marketing automation
complex reports
```

---

# 123. What Nimpass Must Not Become Through UX Drift

User-flow decisions must not accidentally transform Nimpass into:

```text
generic event ticketing

generic appointment booking

generic cryptocurrency marketplace

social network

general-purpose wallet

business CRM suite

generic payment checkout
```

Every major journey should relate back to the service-pass lifecycle.

---

# 124. AI Coding Agent Rules

Before implementing a flow from this document, an AI coding agent must identify:

```text
ACTOR

ENTRY POINT

DEVICE / SURFACE

CURRENT STATE

PRIMARY ACTION

AUTHORITATIVE DATA SOURCE

SUCCESS STATE

FAILURE STATE

UNCERTAIN STATE

RECOVERY PATH

DUPLICATE-ACTION BEHAVIOR

NEXT LOGICAL ACTION
```

Do not implement only the happy-state visual component.

For example, implementing:

```text
Buy Pass button
```

requires thinking about:

```text
preparing
wallet approval
cancel
failure
success
verification
uncertain result
refresh
duplicate click
return from Nimiq Pay
pass creation
```

Similarly:

```text
Confirm Session
```

requires:

```text
processing
success
invalid challenge
expired challenge
duplicate submission
network interruption
state reconciliation
zero sessions
wrong wallet
```

---

# 125. AI Coding Agent Platform Rule

AI agents must not reintroduce the outdated assumption:

> **Nimpass is mobile-first and primarily exists inside Nimiq Pay.**

The current product rule is:

> **Nimpass is a web-first responsive application with deep Nimiq Pay and Nimiq Mini App integration.**

Therefore:

```text
desktop/web layouts may use appropriate screen space

provider management may be desktop-optimized

public URLs are first-class

direct browser access is first-class

mobile responsiveness remains mandatory

customer payment/pass/redemption flows must work exceptionally well on mobile
```

---

# 126. AI Coding Agent Nimiq Rule

Nimiq integration must not be reduced to:

```text
Pay with NIM button
```

The full Nimiq-related customer lifecycle includes:

```text
wallet context

NIM payment

payment confirmation

wallet-linked pass ownership

authorization-sensitive pass access

secure session redemption where required

repeat use
```

Nimiq must be meaningful to the product lifecycle.

---

# 127. AI Coding Agent Design Boundary

This document defines:

> **what the user does and what the user should experience.**

It does not define the final:

```text
color palette
typography
spacing scale
border radius
card styling
exact responsive breakpoints
animation specification
component library
```

Those belong in:

```text
03-DESIGN-SYSTEM.md
```

However, implementation must preserve the interaction philosophy defined here.

---

# 128. Canonical End-to-End Scenario

Use this scenario when evaluating whether Nimpass is functioning correctly.

```text
Alex is a personal trainer.

Alex opens the Nimpass web application.

He creates a provider profile:

Alex Fitness
Personal Trainer

He creates a service:

Personal Training

He creates a package:

10 Personal Training Sessions
250 NIM

Alex previews the package.

He publishes it.

Nimpass provides a public package page.

Alex shares the package URL with Emin.

Emin opens the link from a normal browser on his phone.

The package page opens directly.

Emin sees:

Alex Fitness
Personal Training
10 sessions
250 NIM

He does not need to complete a long onboarding process merely to understand the offer.

Emin chooses:

Buy Pass

Nimpass starts the required Nimiq Pay interaction.

Emin sees what he is purchasing and the 250 NIM amount.

He approves the payment.

Nimpass verifies the payment.

A wallet-linked digital pass is created.

Emin sees:

Personal Training
Alex Fitness
10 sessions remaining

He closes the browser.

A week later Emin opens Nimpass again.

He opens My Passes.

His Personal Training pass is immediately available.

It shows:

10 sessions remaining

Emin attends his training session.

He opens the pass and chooses:

Use Session

Nimpass creates a short-lived redemption challenge.

Emin shows the QR to Alex.

Alex opens the provider redemption flow.

Alex scans the QR.

Nimpass validates:

the challenge is valid,
the pass exists,
the pass is active,
the current owner is authorized,
the pass has sessions remaining,
the redemption has not already succeeded.

Alex sees:

Personal Training

10 sessions remaining

Use one session?

After:
9 sessions remaining

Alex confirms.

Exactly one session is consumed.

Emin sees:

9 sessions remaining.

Alex sees:

Session completed

9 sessions remaining.

The history records the successful redemption.

They repeat this process across multiple sessions.

Eventually:

1 session remaining

becomes:

0 sessions remaining

The pass changes to:

Completed

10 of 10 sessions used.

Emin can still open the completed pass and review its history.

Nimpass offers:

Buy Again

Emin chooses Buy Again.

Nimpass opens Alex's current package.

If the current price or package terms have changed, Emin sees those new terms before payment.

Emin may purchase another pass.

The commercial and product loop continues.
```

If Nimpass supports this scenario reliably on the web and preserves the important customer actions on responsive mobile/Nimiq surfaces, the core product experience is working.

---

# 129. Source-of-Truth Rule

This document defines Nimpass user-flow behavior.

When:

```text
implementation
generated code
mockup
AI suggestion
prototype
design
```

conflicts with this document:

1. identify the conflict,
2. determine whether the implementation or documented flow is wrong,
3. update this document explicitly if the product decision changes,
4. only then update implementation behavior.

Do not silently redefine Nimpass through accumulated UI decisions.

---

# 130. Relationship to Other Documentation

```text
01-PRODUCT.md
→ What Nimpass is

02-USER-FLOWS.md
→ How users move through Nimpass

03-DESIGN-SYSTEM.md
→ How Nimpass looks and feels

04-NIMIQ-MINI-APPS.md
→ How Nimpass behaves in the Nimiq Mini App environment

05-NIMIQ-PAY-INTEGRATION.md
→ How wallet and payment integration works

06-COMPETITION.md
→ Competition rules and requirements

07-SCORING-STRATEGY.md
→ How product decisions maximize competition scoring

08-ARCHITECTURE.md
→ Technical architecture

09-SECURITY.md
→ Security model and trust boundaries

10-SUBMISSION-CHECKLIST.md
→ Final competition readiness
```

When this document refers to:

```text
wallets
payments
QR challenges
signatures
authorization
transaction verification
```

it defines the expected **user-facing behavior**.

Technical implementation details belong in the dedicated integration, architecture, and security documents.

---

# 131. Final User-Flow Principle

The simplest test for every Nimpass flow is:

```text
Can a provider create a 10-session package on the web,

share it,

let a customer understand and purchase it with NIM,

give that customer a persistent wallet-linked pass,

let the customer return days later,

consume exactly one session safely,

always show the correct remaining count,

repeat until zero,

and make purchasing the next pass easy?
```

If yes, the flow supports Nimpass.

If a feature makes that lifecycle harder, less trustworthy, or less understandable, it should be questioned.

The Nimpass experience should ultimately feel:

**simple, persistent, trustworthy, web-native, wallet-aware, and effortless to return to.**
