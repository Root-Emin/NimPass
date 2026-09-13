# Nimpass — Product Definition

> **Document type:** Product source of truth
> **Project:** Nimpass
> **Status:** Active
> **Audience:** Developers, AI coding agents, designers, product contributors
> **Primary purpose:** Define exactly what Nimpass is, who it serves, what problem it solves, how the product works, what its platform priorities are, and what belongs inside or outside the product scope.

---

# 1. Product Summary

**Nimpass is a web-first, responsive digital session pass platform for recurring service businesses, deeply integrated with Nimiq and Nimiq Pay.**

It allows independent service providers to create and sell prepaid multi-session packages and allows customers to purchase those packages using NIM.

After a successful purchase, the customer receives a digital pass associated with their identity and wallet context.

The pass keeps track of:

* the purchased service,
* the service provider,
* the package that was purchased,
* the original number of sessions,
* the number of sessions already used,
* the number of sessions remaining,
* the purchase state,
* the pass state,
* the session usage history.

Each time the customer attends a real-world or online session, one session can be securely redeemed from the pass.

After a successful redemption, the remaining session count decreases by exactly one.

The customer continues using the same pass until all included sessions have been consumed.

When the remaining session count reaches zero, the pass becomes completed and the customer may purchase another package.

Nimpass therefore combines:

**service discovery + package sales + NIM payments + wallet identity + digital pass ownership + session tracking + secure session redemption + repeat usage**

into one coherent web application.

---

# 2. Platform Positioning

Nimpass is **WEB-FIRST**.

This is a fundamental product decision.

Nimpass must first feel like a polished, modern web application.

Its primary application experience must be excellent in:

* desktop browsers,
* laptop browsers.

The same application must also adapt responsively to:

* tablets,
* mobile browsers,
* embedded Nimiq Pay Mini App environments.

Nimpass must never be treated as:

```text
a mobile-only application
```

or:

```text
a phone interface stretched onto desktop
```

The intended platform philosophy is:

```text
Web-first product
        ↓
Responsive application system
        ↓
Desktop / Laptop
Tablet
Mobile Web
Nimiq Pay Mini App
```

Desktop and laptop experiences are first-class product experiences.

Mobile compatibility is mandatory.

Nimiq Pay compatibility is mandatory.

However, neither mobile nor the Nimiq Pay container should dictate the entire product layout.

---

# 3. One-Sentence Product Definition

> **Nimpass lets service providers sell prepaid multi-session packages in NIM and lets customers own, track, and securely redeem those sessions through a digital pass.**

This sentence should be treated as the canonical short definition of the product.

---

# 4. Product Positioning in One Formula

Nimpass can be understood as:

```text
Service Package
+
NIM Payment
+
Digital Pass
+
Remaining Session Tracking
+
Secure Redemption
+
Repeat Usage
```

Nimpass is not simply:

```text
Crypto Payment Button
```

and it is not simply:

```text
Booking Software
```

The digital pass lifecycle is the product.

---

# 5. The Core Problem

Many independent professionals sell services that are not consumed in a single transaction.

Examples include:

* personal training,
* private tutoring,
* language lessons,
* music lessons,
* coaching,
* consulting,
* mentoring,
* sports instruction,
* recurring workshops,
* beauty and wellness services,
* other session-based professional services.

These professionals frequently sell packages such as:

* 4 sessions,
* 5 sessions,
* 8 sessions,
* 10 sessions,
* 12 sessions,
* 20 sessions.

A typical commercial offer may look like:

> **10 Personal Training Sessions**
> 250 NIM

The payment itself is relatively straightforward.

The operational problem begins after the payment.

The provider and customer now need to know:

* how many sessions were purchased,
* how many have already been used,
* how many remain,
* when each session was used,
* whether the customer really owns the package,
* whether the pass is active,
* whether the pass has expired,
* whether a specific session was already redeemed.

Today this information is frequently managed through disconnected and informal systems.

Examples include:

* WhatsApp messages,
* spreadsheets,
* handwritten notes,
* calendar entries,
* screenshots,
* manually maintained customer lists,
* basic payment records,
* memory.

These systems create several problems.

They are difficult to verify.

They are easy to forget.

They require manual administration.

The customer and provider may hold different records.

A session may accidentally be counted twice.

A provider may forget to record a session.

A customer may not know how many sessions remain.

Payment history and service usage usually live in different systems.

Nimpass solves this by transforming a prepaid service package into a persistent digital pass.

---

# 6. The Nimpass Solution

A provider creates a service.

Example:

```text
Personal Training
```

The provider then creates a package for that service.

Example:

```text
10 Personal Training Sessions

Provider:
Alex Fitness

Sessions:
10

Price:
250 NIM
```

A customer opens the package through Nimpass.

The customer understands:

* who is selling it,
* what service is included,
* how many sessions are included,
* how much it costs,
* what happens after purchase.

The customer purchases the package using NIM.

After the payment is successfully confirmed, Nimpass creates a customer-specific digital pass.

Example:

```text
Personal Training

Alex Fitness

7 sessions remaining

3 of 10 used
```

The pass remains accessible throughout its lifecycle.

When the customer attends another session, the provider and customer participate in a secure redemption process.

Example:

```text
Before

Remaining: 7
Used:      3

↓ Redeem one session

After

Remaining: 6
Used:      4
```

The pass therefore becomes a persistent digital record of the service relationship.

---

# 7. Core Product Loop

The core Nimpass product loop is:

```text
Discover Service
        ↓
View Provider / Package
        ↓
Purchase Package
        ↓
Pay with NIM
        ↓
Receive Digital Pass
        ↓
Return Later
        ↓
Attend Session
        ↓
Redeem One Session
        ↓
Remaining Sessions Decrease
        ↓
Return for Another Session
        ↓
Redeem Again
        ↓
Pass Reaches Zero
        ↓
Pass Completed
        ↓
Purchase Again
```

This loop is fundamental.

Every major feature should strengthen this lifecycle rather than distract from it.

---

# 8. Why Nimpass Is Not a Single-Payment Application

Nimpass must never be treated as a simple cryptocurrency checkout experience.

This:

```text
Select Service
↓
Pay NIM
↓
Done
```

does not represent Nimpass.

Payment is only one stage of the product lifecycle.

The complete relationship is:

```text
Payment
   ↓
Pass Creation
   ↓
Pass Ownership
   ↓
Persistent Access
   ↓
Repeated Usage
   ↓
Session Redemption
   ↓
Usage History
   ↓
Completion
   ↓
Repurchase
```

A Nimpass may remain useful for:

* several days,
* several weeks,
* several months.

Repeated usage is one of the defining characteristics of the product.

---

# 9. Product Philosophy

Nimpass should transform something that is traditionally manually tracked into an experience that feels:

* simple,
* trustworthy,
* modern,
* persistent,
* transparent.

The user should not feel like they are operating blockchain infrastructure.

They should feel like they own a modern digital service pass.

The experience should prioritize:

* simplicity,
* trust,
* clarity,
* low cognitive load,
* transparent session counts,
* clear ownership,
* clear payment state,
* clear redemption state,
* repeat usage,
* responsive usability,
* professional web experience.

Blockchain and wallet functionality should support the experience.

They should not visually dominate it.

---

# 10. Platform Philosophy

Nimpass is not designed around a single screen size.

The product is designed around a single **responsive system**.

Large screens should use available space intelligently.

For example, desktop experiences may use:

* side navigation,
* multi-column layouts,
* package grids,
* management tables,
* contextual side panels,
* richer dashboards,
* larger content surfaces.

Smaller screens may adapt the same experience into:

* stacked layouts,
* compact navigation,
* cards instead of wide tables,
* drawers or sheets,
* touch-friendly actions,
* simplified information density.

The correct approach is not:

```text
Design mobile
↓
stretch to desktop
```

and not:

```text
Design desktop
↓
shrink until it fits mobile
```

The correct approach is:

```text
Shared product system
        ↓
Responsive layout adaptation
        ↓
Intentional experience for each viewport
```

---

# 11. Target Users

Nimpass has two primary user groups.

## 11.1 Service Providers

A service provider is a person or organization that sells services delivered across multiple sessions.

Examples include:

* personal trainers,
* private tutors,
* language teachers,
* music teachers,
* coaches,
* consultants,
* mentors,
* sports instructors,
* workshop instructors,
* wellness professionals,
* independent professionals selling recurring appointments.

The provider needs a simple way to:

* create services,
* create packages,
* define package prices,
* define session quantities,
* publish packages,
* share packages,
* receive NIM payments,
* see purchased passes,
* see active passes,
* validate customers,
* redeem sessions,
* prevent duplicate redemption,
* see remaining session counts,
* inspect relevant history,
* manage completed passes.

---

## 11.2 Customers

A customer purchases and consumes a provider's service package.

The customer needs to:

* understand the package,
* understand the provider,
* know how many sessions are included,
* understand the price,
* pay easily,
* receive their pass,
* return to the pass later,
* see how many sessions remain,
* review previous usage,
* securely redeem sessions,
* understand the pass state,
* purchase another package when needed.

The customer experience must be simpler than manually maintaining this information.

---

# 12. Usage Context

Providers and customers may use Nimpass differently.

A provider may frequently operate Nimpass from a desktop or laptop while managing:

* services,
* packages,
* customers,
* active passes,
* history,
* operational activity.

Provider workflows therefore must not be designed as if the provider always uses a phone.

A customer may access Nimpass through:

* desktop web,
* laptop web,
* tablet,
* mobile browser,
* Nimiq Pay.

Customer interfaces should remain lightweight and easy to understand across all these environments.

---

# 13. Example Use Cases

The Nimpass model must remain generic enough to support multiple session-based industries.

## 13.1 Personal Trainer

```text
Service:
Personal Training

Package:
10 Sessions

Price:
250 NIM

Customer purchases package.

After session #1:
9 sessions remain.

After session #5:
5 sessions remain.

After session #10:
Pass completed.
```

---

## 13.2 Private Tutor

```text
Service:
Mathematics Tutoring

Package:
8 Lessons

Price:
180 NIM

Each lesson consumes one session.

The student can always see
how many lessons remain.
```

---

## 13.3 Language Teacher

```text
Service:
Private English Lessons

Package:
12 Lessons

Price:
300 NIM

Initial:
12 / 12 available

After three lessons:
9 / 12 available
```

---

## 13.4 Coach

```text
Service:
Career Coaching

Package:
5 Sessions

Price:
150 NIM

The customer purchases once.

The same pass is used
across all five sessions.
```

---

# 14. The Digital Pass

The Digital Pass is the central product object in Nimpass.

It represents the customer's entitlement to consume a predefined number of sessions from a specific purchased package.

Conceptually:

```text
Pass
│
├── Provider
├── Service
├── Package
├── Owner
├── Original session count
├── Used session count
├── Remaining session count
├── Purchase information
├── Pass status
├── Creation date
├── Optional expiration date
└── Session history
```

A pass should be understandable immediately.

The most important information is usually:

```text
Service Name

Provider Name

7 sessions remaining

3 of 10 used
```

The remaining session count should be one of the most visually prominent pieces of information in Nimpass.

---

# 15. Pass Ownership

A pass belongs to the customer who purchased it.

Wallet identity may play an important role in establishing and verifying that ownership.

The system must be able to distinguish:

```text
Knowing that a pass exists
```

from:

```text
Being authorized to use that pass
```

A person must not gain ownership merely because they possess:

* a shared URL,
* a screenshot,
* a QR code,
* a pass identifier,
* another publicly visible reference.

The exact wallet and authorization implementation belongs to the dedicated Nimiq and security documentation.

---

# 16. Wallet Role in the Product

Nimiq wallet functionality is important to Nimpass, but it must be used purposefully.

Wallet functionality may contribute to:

```text
NIM payments
Pass ownership
Customer identity context
Authorization
Session redemption verification
```

The wallet is therefore more meaningful than a simple payment method.

However:

```text
Nimpass ≠ Wallet Application
```

The wallet supports the product.

The product must not become a wallet dashboard.

---

# 17. Service vs Package vs Pass

These three concepts must never be confused.

## Service

The underlying activity.

Example:

```text
Personal Training
```

---

## Package

The commercial offering.

Example:

```text
10 Personal Training Sessions
250 NIM
```

---

## Pass

A specific customer's purchased entitlement.

Example:

```text
Owner:
Customer A

Purchased:
10 sessions

Used:
3

Remaining:
7
```

Relationship:

```text
SERVICE

Personal Training
      │
      ▼
PACKAGE

10 Sessions
250 NIM
      │
      ▼
PURCHASE
      │
      ▼
PASS

Customer-specific entitlement
```

A package may be purchased many times.

Every valid purchase creates a separate pass.

---

# 18. Package Definition

Providers sell packages.

Example:

```text
Title:
10 Personal Training Sessions

Provider:
Alex Fitness

Service:
Personal Training

Session count:
10

Price:
250 NIM

Description:
Ten private personal training sessions.

Expiration:
Optional
```

The package defines the commercial offer.

It does not represent a specific customer.

---

# 19. Package Snapshot Principle

Already purchased passes must not silently change when the provider modifies a package later.

Suppose the customer buys:

```text
10 sessions
250 NIM
```

Later, the provider changes the package to:

```text
8 sessions
300 NIM
```

The existing customer's pass must remain based on the purchased terms.

Therefore:

```text
Package = current commercial offering

Pass = purchased entitlement based on historical purchase terms
```

These must remain separate.

---

# 20. Provider Profile

A provider may have a public-facing profile.

Its job is to establish:

```text
Who is providing the service?

What do they offer?

Which packages can I purchase?
```

A provider profile may contain:

* name,
* profile image,
* brand image,
* short description,
* services,
* available packages,
* relevant public information.

Example:

```text
Alex Fitness

Personal Trainer

Helping people build strength
and healthier habits.

Packages

5 Sessions
10 Sessions
20 Sessions
```

A provider profile is primarily a commerce and trust surface.

It must not become a full social network.

---

# 21. Package Discovery

Packages should be straightforward to discover and share.

Potential entry points include:

* Nimpass web application,
* provider profile,
* direct package URL,
* shared link,
* QR code,
* Nimiq Pay Mini App discovery,
* future discovery mechanisms.

The standard web application must remain a first-class entry point.

Nimpass does not require a large marketplace in its first version.

A direct-link-first experience is valid.

The important requirement is:

> A customer must be able to reliably reach a provider's package and understand the offer.

---

# 22. Purchase Experience

Before paying, the customer must clearly understand:

* provider,
* service,
* package,
* number of sessions,
* price,
* currency,
* applicable expiration,
* what they receive after payment.

Example:

```text
10 Personal Training Sessions

Alex Fitness

10 private training sessions

10 sessions

250 NIM

Includes:

• Digital Nimpass
• 10 sessions
• Session history

[ Buy Pass ]
```

There must be no ambiguity about what is being purchased.

---

# 23. Payment Relationship

NIM payment is fundamental to Nimpass.

However, payment alone is not the product.

Conceptually:

```text
Package selected
      ↓
Payment initiated
      ↓
Payment confirmed
      ↓
Pass created
      ↓
Pass associated with customer
      ↓
Pass becomes available
```

The system must distinguish:

```text
payment initiated
payment awaiting confirmation
payment cancelled
payment failed
payment confirmed
pass creation pending
pass successfully created
```

A frontend success screen alone must never be treated as sufficient proof that the user owns an active pass.

Detailed Nimiq payment implementation belongs in the dedicated integration documentation.

---

# 24. Session Redemption

Session redemption means consuming one available session from an active pass.

Example:

```text
10-session pass

Current:
6 remaining

Customer attends session.

Provider and customer participate
in the required validation flow.

Redemption succeeds.

New state:
5 remaining
```

A successful redemption must represent a real authoritative state change.

It must never be merely a frontend animation.

---

# 25. Redemption Is Device-Agnostic

Session redemption is a product concept.

QR scanning is only one possible interaction mechanism.

Depending on device and environment, redemption may use:

* short-lived QR code,
* one-time code,
* secure validation link,
* provider-side validation,
* wallet authorization,
* another approved challenge mechanism.

For example:

```text
Mobile customer
→ displays QR

Desktop customer
→ displays short-lived code

Provider
→ validates challenge
```

The underlying security and business rules must remain consistent regardless of transport.

Nimpass must not become dependent on mobile QR scanning as the only way to use the product.

---

# 26. Redemption Rules

The following rules are fundamental.

## Rule 1 — One redemption consumes exactly one session

Unless a future deliberate product decision introduces another behavior:

```text
remainingSessions =
remainingSessions - 1
```

---

## Rule 2 — Session count cannot become negative

If:

```text
remainingSessions = 0
```

another redemption is not allowed.

---

## Rule 3 — Duplicate redemption must be prevented

These must not accidentally consume multiple sessions:

* repeated button taps,
* API retry,
* network retry,
* browser refresh,
* duplicate request,
* rescanning the same QR,
* resubmitting the same redemption code.

---

## Rule 4 — Only valid passes may be redeemed

A pass must not be redeemable when it is:

* completed,
* cancelled,
* invalid,
* expired where expiration applies,
* unavailable,
* being used by an unauthorized identity.

---

## Rule 5 — Successful redemption must be auditable

The system should be able to establish:

* which pass was redeemed,
* when it happened,
* what resulting session count was produced.

---

# 27. Session History

Customers should be able to understand how their pass was used.

Example:

```text
Personal Training
10 Session Pass

Sep 12
Session redeemed
7 → 6 remaining

Sep 8
Session redeemed
8 → 7 remaining

Sep 3
Session redeemed
9 → 8 remaining

Aug 29
Session redeemed
10 → 9 remaining
```

The history improves transparency.

It helps answer:

> Did we already count the previous session?

and:

> Why do I have six sessions remaining?

The user should not need to rely on memory.

---

# 28. Pass Statuses

A pass has a clear lifecycle.

## Pending

The purchase or pass creation process has not completed.

```text
PENDING
```

The pass cannot be redeemed.

---

## Active

The pass exists and has at least one usable session.

```text
ACTIVE
```

---

## Completed

All sessions have been consumed.

```text
remainingSessions = 0
```

The pass becomes:

```text
COMPLETED
```

History remains available.

---

## Expired

If expiration applies and the date has passed:

```text
EXPIRED
```

Unused session information may remain visible.

Redemption is blocked unless future rules explicitly define another behavior.

---

## Cancelled

If a pass is administratively cancelled:

```text
CANCELLED
```

Cancellation must not silently destroy historical records.

---

# 29. Customer Pass Collection

Customers should have a dedicated place to access their passes.

Example:

```text
My Passes

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

This area is fundamental because Nimpass is designed around repeat usage.

The customer must not need to rediscover an old payment page every time they want to use their pass.

---

# 30. Provider Workspace

Providers require more operational functionality than customers.

The provider experience may include:

* overview,
* services,
* packages,
* active passes,
* completed passes,
* session validation,
* activity history,
* basic operational metrics.

On desktop and laptop, the provider workspace may use:

* persistent side navigation,
* multi-column layouts,
* management tables,
* filters,
* contextual panels,
* dashboard cards.

On smaller screens, the same capabilities should adapt appropriately.

Provider workflows must never be unnecessarily constrained by mobile layout assumptions.

---

# 31. Return Value

Nimpass must give both customer and provider a reason to return.

The customer returns to:

* see remaining sessions,
* access passes,
* redeem another session,
* view history,
* purchase again.

The provider returns to:

* manage packages,
* validate sessions,
* inspect active passes,
* serve repeat customers,
* review operational activity.

The product should therefore optimize for repeated use rather than a one-time transaction.

---

# 32. Customer Value Proposition

For customers, Nimpass should answer:

> **How many sessions do I have left?**

immediately and confidently.

The customer receives:

## Visibility

Know how many sessions remain.

## Ownership

Access a pass associated with their identity and purchase.

## Transparency

See previous usage.

## Convenience

Avoid:

* spreadsheets,
* screenshots,
* paper cards,
* searching message history.

## Payment + Usage Continuity

The payment and resulting service entitlement exist in the same product experience.

---

# 33. Provider Value Proposition

For providers, Nimpass should answer:

> **How can I sell and manage prepaid session packages without manually tracking every customer's balance?**

Providers receive:

## Package Sales

Create multi-session offers.

## NIM Payments

Sell those packages using NIM.

## Pass Management

Understand which customers have usable passes.

## Session Validation

Consume sessions through a controlled process.

## Reduced Administration

Reduce manual tracking.

## Shared State

Provider and customer rely on the same source of truth.

## Repeat Business

Completed passes naturally create an opportunity for repurchase.

---

# 34. The Physical Punch Card Analogy

A useful mental model is a digital punch card.

Traditional example:

```text
Coffee Card

[✓] [✓] [✓] [ ] [ ] [ ] [ ] [ ] [ ] [ ]
```

Nimpass applies a similar concept to prepaid professional services.

```text
Personal Training Pass

10 sessions purchased

3 sessions used

7 sessions remaining
```

But Nimpass can additionally combine:

* payment,
* ownership,
* verification,
* digital history,
* wallet context,
* secure redemption.

The analogy is useful for understanding the basic idea.

Nimpass must not visually or conceptually become merely a loyalty punch card.

---

# 35. Nimpass Is Not a Loyalty Program

A loyalty program usually behaves like:

```text
Buy products repeatedly
→ receive reward
```

Nimpass behaves like:

```text
Buy multiple sessions in advance
→ consume purchased sessions over time
```

It represents prepaid entitlement.

Not rewards.

---

# 36. Nimpass Is Not an Event Ticketing Platform

An event ticket usually represents:

```text
One event
+
One admission
```

Nimpass represents:

```text
One purchase
+
Multiple future service usages
```

Example:

```text
Concert Ticket

enter once
→ consumed
```

versus:

```text
10 Session Nimpass

session 1
session 2
session 3
...
session 10
```

Nimpass may use verification concepts also seen in ticketing applications.

The underlying product model remains different.

---

# 37. Nimpass Is Not Primarily a Booking System

Scheduling may eventually integrate with Nimpass.

However, booking is not the primary problem.

The core problem is:

```text
purchase
+
ownership
+
remaining-session tracking
+
redemption
```

not:

```text
calendar scheduling
```

A provider may continue using another system for appointment scheduling.

Nimpass tracks the service entitlement.

---

# 38. Nimpass Is Not a Generic Crypto Marketplace

Nimpass must not evolve into a marketplace for arbitrary cryptocurrency purchases.

The product identity is:

> **Digital session passes for recurring services.**

Not:

> **Buy anything with NIM.**

NIM exists as part of the Nimpass service-package lifecycle.

---

# 39. Nimpass Is Not a Cryptocurrency Wallet

Nimpass must not attempt to replace Nimiq Pay or other wallet infrastructure.

Nimpass should not implement unnecessary:

* private-key management,
* seed phrase management,
* cryptocurrency portfolio management,
* arbitrary token trading,
* wallet infrastructure unrelated to the product.

Nimiq Pay handles wallet responsibilities where applicable.

Nimpass handles the service-pass experience.

---

# 40. Nimpass Is Not Mobile-Only

Nimpass must not gradually become a mobile-only application because some wallet or redemption interactions happen conveniently on phones.

Do not make assumptions such as:

```text
every provider scans QR with a phone
```

or:

```text
every customer opens Nimpass from Nimiq Pay
```

or:

```text
desktop is only a compatibility fallback
```

These assumptions are incorrect.

Nimpass is a web product that also works extremely well on mobile and inside Nimiq Pay.

---

# 41. Product Boundaries

Features should belong to Nimpass when they improve one or more of:

```text
Service Discovery
Provider Trust
Package Purchase
NIM Payment
Pass Ownership
Pass Management
Session Tracking
Session Redemption
Session History
Provider Operations
Customer Trust
Repeat Usage
Repurchase
```

A feature that does not meaningfully improve the lifecycle should be questioned.

---

# 42. MVP Definition

The first production-ready Nimpass must support the complete core lifecycle.

## Provider

The provider can:

* establish a provider profile,
* create a service,
* create a package,
* define session quantity,
* define NIM price,
* publish a package,
* share a package,
* see relevant purchased passes,
* participate in session validation,
* see pass state.

---

## Customer

The customer can:

* open a provider or package,
* understand the offer,
* purchase the package,
* pay in NIM,
* receive a digital pass,
* access that pass later,
* see remaining sessions,
* redeem a session securely,
* see the updated count,
* view basic session history.

---

## System

The system can:

* distinguish payment states,
* create passes under valid purchase conditions,
* associate passes with their owners,
* preserve purchased package terms,
* maintain correct session counts,
* prevent negative balances,
* reject invalid redemption,
* prevent duplicate consumption,
* retain redemption history,
* mark zero-session passes as completed.

If these flows do not work reliably, Nimpass is not considered complete.

---

# 43. MVP Platform Requirements

The MVP must provide a production-quality responsive web experience.

At minimum, the application must work properly across:

```text
Desktop web
Laptop web
Tablet layouts
Mobile web
Nimiq Pay Mini App environment
```

Desktop and laptop are primary supported environments.

Mobile is a primary supported responsive environment.

Nimiq Pay is a primary supported integration environment.

No one environment should unnecessarily damage the experience of another.

---

# 44. MVP Non-Goals

The MVP should not become overloaded with unrelated functionality.

Unless explicitly approved later, the following are not core MVP requirements:

* complex social networking,
* follower systems,
* comments,
* public social feeds,
* cryptocurrency trading,
* NFT marketplaces,
* full calendar replacement,
* enterprise CRM,
* complex invoicing,
* payroll,
* messaging platform,
* video calling,
* general e-commerce,
* complex reward systems,
* speculative token mechanics,
* unnecessary gamification.

These features risk distracting from the core product.

---

# 45. Product Success Criteria

A new customer should be able to:

```text
1. Open Nimpass.

2. Find or open a package.

3. Understand the provider.

4. Understand the service.

5. Understand the number of sessions.

6. Understand the NIM price.

7. Purchase the package.

8. Receive a pass.

9. Leave Nimpass.

10. Return later.

11. Find the pass again.

12. Immediately understand
    how many sessions remain.

13. Redeem one session.

14. See the updated count.

15. Repeat until completion.

16. Buy another package if desired.
```

A provider should similarly be able to:

```text
1. Create a service.

2. Create a package.

3. Publish it.

4. Share it.

5. Receive a customer purchase.

6. Validate a session.

7. See the pass update.

8. Repeat until completion.
```

If these workflows require manual correction or explanation, the core product still needs work.

---

# 46. UX Principle: Remaining Sessions Must Always Be Clear

For an active pass, the most important customer question is:

> **How many sessions do I have left?**

This information should never be hidden behind unnecessary navigation.

Bad:

```text
Settings
→ Package
→ Usage
→ Balance
→ 7
```

Better:

```text
Personal Training

7 sessions remaining

3 of 10 used

[ Redeem Session ]
```

Immediate comprehension takes priority.

---

# 47. UX Principle: User Language Over Technical Language

Prefer:

```text
Buy Pass
```

over:

```text
Initiate Blockchain Transaction
```

Prefer:

```text
7 sessions remaining
```

over:

```text
Entitlement balance: 7
```

Prefer:

```text
Session used
```

over:

```text
Redemption transaction finalized
```

Technical information may exist where useful.

It must not dominate the normal product experience.

---

# 48. UX Principle: Trust Through Explicit State

Important state changes must always be understandable.

Example:

## Payment successful

```text
Payment successful

Your pass is ready.
```

## Payment cancelled

```text
Payment cancelled

You were not charged.
```

## Redemption successful

```text
Session used

6 sessions remaining.
```

## Pass completed

```text
Pass completed

You have used all 10 sessions.
```

Users should never have to guess whether an important operation succeeded.

---

# 49. Product Principle: No Fake State

Frontend visuals must reflect real application state.

Nimpass must never pretend:

* payment succeeded when it did not,
* a pass exists when it was not created,
* a session was redeemed when the operation failed,
* a user owns a pass when ownership was not established.

Successful-looking UI without successful underlying state is unacceptable.

---

# 50. Product Principle: Idempotent Critical Actions

Critical actions must behave safely when repeated.

For example:

```text
double-click
network retry
browser refresh
API retry
```

must not accidentally create:

* multiple passes for one purchase,
* multiple deductions for one session.

Reliability is part of the product definition.

---

# 51. Product Principle: Web First, Responsive Everywhere

Nimpass is **WEB-FIRST**.

The primary interface must provide an excellent experience in modern desktop and laptop browsers.

It must also adapt gracefully to:

* tablets,
* mobile browsers,
* Nimiq Pay Mini App environments.

Desktop usage is first-class.

Do not reduce desktop capability or information density simply because Nimpass also runs on mobile.

Large screens may intelligently use:

* persistent navigation,
* multi-column layouts,
* rich dashboards,
* grids,
* tables,
* side panels,
* broader management views.

Smaller screens may transform these into:

* stacked content,
* cards,
* compact navigation,
* drawers,
* sheets,
* touch-friendly controls.

The layout may change.

The product capability should remain.

---

# 52. Product Principle: Responsive Does Not Mean Identical

Responsive design does not mean forcing every device to use the exact same layout.

For example:

Desktop provider view:

```text
┌────────────┬──────────────────────────────┐
│ Sidebar    │ Dashboard                    │
│            │                              │
│ Overview   │ Active Passes       Activity │
│ Services   │                              │
│ Packages   │ Packages            Metrics  │
│ Passes     │                              │
└────────────┴──────────────────────────────┘
```

Mobile provider view:

```text
Overview

Active Passes
18

Packages
3

Recent Activity

[ Validate Session ]
```

Both represent the same product.

The information hierarchy adapts to available space.

---

# 53. Product Principle: Minimum Friction

A user should not be forced through unnecessary onboarding before understanding the product.

Whenever technically and securely possible:

```text
Open package
→ understand offer
→ purchase
```

is preferable to:

```text
Open app
→ register
→ password
→ verify email
→ profile
→ onboarding
→ find package
→ purchase
```

Nimiq wallet identity may help reduce unnecessary friction where it provides genuine product or security value.

Wallet interaction should not be forced before it is actually needed.

---

# 54. Product Principle: Progressive Disclosure

Users should first see what matters most.

Example pass:

```text
Personal Training

Alex Fitness

7 sessions remaining

3 of 10 used

[ Redeem Session ]
```

Secondary information may include:

* transaction details,
* full history,
* package metadata,
* technical identifiers.

Complexity should only appear when necessary.

---

# 55. Product Principle: Nimiq Integration Without Web3 Clutter

Nimiq is strategically important to Nimpass.

But the interface must not become filled with unnecessary blockchain terminology.

Nimiq integration should feel native to the product.

The customer should think:

> I am purchasing a session pass.

Not:

> I am executing a blockchain workflow.

The provider should think:

> This customer has six sessions remaining.

Not:

> I am operating an on-chain entitlement ledger.

The technical foundation may be sophisticated.

The experience should remain simple.

---

# 56. Repeat Purchase

Pass completion should naturally support another purchase.

Example:

```text
Pass completed

10 of 10 sessions used.

[ Buy Again ]
```

The commercial loop becomes:

```text
Purchase
→ Consume
→ Complete
→ Repurchase
```

However, `Buy Again` must show the current package offer.

It must not silently reuse outdated:

* pricing,
* session quantities,
* expiration rules,
* availability.

---

# 57. Potential Future Extensions

The architecture may eventually support:

* additional package sizes,
* package expiration,
* pass gifting,
* controlled transfer rules,
* promotions,
* provider analytics,
* customer notifications,
* optional appointment integrations,
* multiple service locations,
* provider teams,
* recurring renewals,
* customer notes,
* availability rules,
* richer discovery.

These are future possibilities.

They must not destabilize the core lifecycle.

---

# 58. Canonical Example

Use this example when explaining Nimpass to a developer, designer, or AI coding agent.

```text
Alex is a personal trainer.

Alex opens the Nimpass web application
and creates a provider profile.

Alex creates:

Personal Training

Then he creates:

10 Personal Training Sessions
250 NIM

The package receives a shareable page.

Emin opens the package from his browser.

He sees:

Alex Fitness
Personal Training
10 sessions
250 NIM

Emin purchases it using NIM.

After successful payment,
Nimpass creates his pass.

The pass shows:

Personal Training

10 sessions remaining

Emin closes the application.

One week later,
he opens Nimpass again.

He accesses My Passes.

His Personal Training pass appears.

He attends his first training session.

A secure redemption challenge is created.

Alex validates the session.

The system confirms that:

the pass is valid,
the customer is authorized,
the pass has remaining sessions,
the redemption was not previously consumed.

One session is deducted.

Emin now sees:

9 sessions remaining.

Alex also sees the updated state.

They repeat the process over several weeks.

Eventually:

0 sessions remaining.

The pass becomes completed.

The full usage history remains accessible.

Emin may now purchase another package.
```

If a proposed feature does not fit naturally into this or another equivalent session-based scenario, question whether it belongs to the core product.

---

# 59. Product Vocabulary

Use the following terminology consistently.

| Term                   | Meaning                                     |
| ---------------------- | ------------------------------------------- |
| **Nimpass**            | The product/platform                        |
| **Provider**           | Person or business providing a service      |
| **Customer**           | Person purchasing and consuming the service |
| **Service**            | Underlying activity, e.g. Personal Training |
| **Package**            | Sellable bundle of sessions                 |
| **Pass**               | Customer-specific purchased entitlement     |
| **Session**            | One unit of service consumption             |
| **Remaining Sessions** | Sessions still available                    |
| **Used Sessions**      | Sessions already consumed                   |
| **Redemption**         | Process that consumes one session           |
| **Pass Owner**         | Customer authorized to use a specific pass  |
| **Active Pass**        | Pass with usable sessions                   |
| **Completed Pass**     | Pass whose sessions are fully consumed      |
| **Provider Workspace** | Provider-facing management area             |
| **My Passes**          | Customer-facing collection of owned passes  |

Do not invent alternative terminology without an explicit product decision.

---

# 60. Product Invariants

The following statements should remain true throughout development.

1. A service represents an underlying activity.

2. A package represents a commercial offering.

3. A pass represents a specific customer's purchased entitlement.

4. A successful valid purchase creates a customer-specific pass.

5. A pass preserves the relevant purchased package terms.

6. A pass belongs to an identifiable customer context.

7. A pass has a finite original session quantity.

8. Remaining sessions cannot exceed the original quantity.

9. Remaining sessions cannot become negative.

10. One standard successful redemption consumes exactly one session.

11. Duplicate redemption must not consume multiple sessions.

12. A completed pass cannot continue being redeemed.

13. Payment state and pass state are separate concepts.

14. Failed or cancelled payments must not create usable active passes.

15. History remains available after completion.

16. Remaining sessions must be understandable without technical knowledge.

17. Wallet technology supports the product rather than dominating it.

18. Nimpass remains a multi-session service-pass product.

19. Existing passes must not silently change when a package definition changes.

20. Web is a first-class platform.

21. Desktop and laptop experiences are first-class experiences.

22. Mobile responsiveness is mandatory.

23. Nimiq Pay compatibility is mandatory.

24. Nimiq Pay compatibility must not turn Nimpass into a mobile-only product.

These invariants must not be violated casually.

---

# 61. Decision Test for New Features

Before adding a major feature, ask:

```text
Does this help providers sell session packages?

Does this help customers understand packages?

Does this improve purchasing?

Does this strengthen pass ownership?

Does this improve session tracking?

Does this improve redemption?

Does this improve reliability?

Does this improve trust?

Does this increase useful repeat usage?

Does this reduce friction?

Does this work coherently in our web-first model?

Can it adapt responsively?

Does it strengthen Nimiq integration
without adding unnecessary Web3 complexity?
```

If the answer is no to almost all of these questions, the feature probably does not belong in the current product.

---

# 62. Platform Decision Test

Before implementing a major interface, ask:

```text
What does this look like on desktop?

What does this look like on laptop?

How does this adapt on tablet?

How does this adapt on mobile?

Does it still work inside Nimiq Pay?

Did we accidentally remove useful desktop capability?

Did we accidentally make mobile unusable?

Are we adapting layout
or merely shrinking/stretching it?
```

Every important screen should pass this test.

---

# 63. Short Product Pitch

> **Nimpass is a web-first digital session pass platform for recurring services. Providers such as trainers, tutors, and coaches can sell prepaid multi-session packages in NIM, while customers receive a persistent digital pass that shows exactly how many sessions remain and allows each session to be securely redeemed over time.**

---

# 64. Ultra-Short Product Pitch

> **Buy sessions. Own your pass. Use them over time. Pay with NIM.**

---

# 65. Platform Summary

Nimpass is:

```text
WEB-FIRST
RESPONSIVE
DESKTOP-FIRST-CLASS
LAPTOP-FIRST-CLASS
MOBILE-FRIENDLY
NIMIQ-INTEGRATED
NIMIQ-PAY-COMPATIBLE
```

Nimpass is not:

```text
MOBILE-ONLY
PHONE-FIRST
NIMIQ-PAY-ONLY
A GENERIC WEB3 DASHBOARD
```

The implementation must preserve this distinction.

---

# 66. Final Product Principle

The simplest way to understand Nimpass is:

```text
A customer should be able
to purchase ten sessions today,

use one next week,

use another the week after,

and always know exactly
how many remain.
```

Everything else exists to make that experience:

**simple, trustworthy, secure, transparent, responsive, and pleasant.**

---

# Source-of-Truth Rule

This document defines the product identity of Nimpass.

When:

* implementation details,
* generated code,
* AI suggestions,
* mockups,
* new features,
* technical shortcuts,

conflict with this document, do not silently redefine the product.

Instead:

1. identify the conflict,
2. determine whether the implementation or product definition should change,
3. explicitly update this document if a new product decision is approved,
4. only then change the implementation.

Nimpass must not gradually drift into another product because implementation decisions accumulate over time.

In particular, do not allow the project to drift from:

```text
web-first responsive digital session pass
```

into:

```text
mobile-only Mini App
```

or:

```text
generic cryptocurrency payment application
```

without an explicit product decision.

---

# Relationship to Other Documentation

This document defines **what Nimpass is**.

The rest of the documentation should build on top of it.

```text
01-PRODUCT.md
→ What Nimpass is

02-USER-FLOWS.md
→ How providers and customers use it

03-DESIGN-SYSTEM.md
→ How Nimpass looks and feels

04-NIMIQ-MINI-APPS.md
→ How the Nimiq Mini App environment works

05-NIMIQ-PAY-INTEGRATION.md
→ How wallet and payment integration works

06-COMPETITION.md
→ Competition requirements

07-SCORING-STRATEGY.md
→ How product decisions support competition scoring

08-ARCHITECTURE.md
→ Technical architecture

09-SECURITY.md
→ Security model and trust boundaries

10-SUBMISSION-CHECKLIST.md
→ Competition readiness
```

No downstream document should redefine the fundamental product identity established here without an explicit update to `01-PRODUCT.md`.
