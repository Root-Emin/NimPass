Design **Nimpass from the ground up as a complete web application.**

Do not think about implementation, frameworks, APIs, databases, blockchain architecture, or technical constraints.

Focus entirely on **what Nimpass is as a product, what exists inside it, what users need to accomplish, and how the overall experience should be organized.**

## What is Nimpass?

Nimpass is a platform for buying and managing prepaid session-based services.

It is designed for services that people do not purchase only once, but return to repeatedly over time.

Examples include:

* personal training
* private tutoring
* language lessons
* music lessons
* coaching
* wellness services
* yoga or pilates sessions
* consulting
* mentoring
* beauty and personal care services
* other appointment or session-based professional services

A professional can offer a Pass such as:

**10 Personal Training Sessions**

A customer purchases the Pass and receives a digital **Nimpass** representing those 10 sessions.

Every time the customer attends a session, one session is used.

The pass then becomes:

10 sessions
→ 9 sessions
→ 8 sessions
→ 7 sessions
→ eventually completed.

The central idea of the product is therefore:

**Discover a professional → Buy a session Pass → Receive a pass → Use sessions over time → Track what remains → Buy again when needed.**

---

## Two Main Sides of Nimpass

Nimpass has two interconnected experiences.

### Customer Experience

Customers use Nimpass to discover services, buy session Passes and manage the passes they already own.

### Provider Experience

Professionals use Nimpass to present their services, create Passes, sell them and manage customers who own their passes.

Both sides belong to the same product and should feel closely connected.

---

# CUSTOMER EXPERIENCE

## Discover

Nimpass should have a discovery experience where users can browse services and professionals.

Users may explore categories such as:

* Fitness
* Tutoring
* Languages
* Coaching
* Wellness
* Music
* Beauty
* Consulting
* Mentoring

The purpose is not to create an enormous marketplace.

Discovery should feel curated and focused on finding professionals and services worth returning to regularly.

The page may contain:

* featured services
* popular Passes
* categories
* recommended professionals
* recently added services
* search
* simple category filters

---

## Search

Users should be able to search for:

* a service
* a professional
* a category
* a Pass

For example:

“Personal Training”

“English Tutor”

“Yoga”

“Alex Fitness”

---

## Provider Profiles

Every professional should have a public profile.

A provider profile should help the customer understand:

* who the professional is
* what they do
* what services they offer
* what Passes are available
* what each Pass includes
* how many sessions are included
* how much Passes cost
* basic information about the professional

Example:

**Alex Morgan**

Personal Trainer

Private strength and conditioning coaching.

Available Passes:

5 Personal Training Sessions

10 Personal Training Sessions

20 Personal Training Sessions

The profile should feel like the professional's own public Nimpass page.

---

## Services

A provider may offer multiple services.

For example:

Alex Fitness

**Personal Training**

**Nutrition Coaching**

**Mobility Training**

Each service may have multiple Passes.

---

## Passes

Passes are the main purchasable products in Nimpass.

A Pass represents a specific number of sessions for a particular service.

Example:

**10 Personal Training Sessions**

Alex Fitness

10 sessions

250 NIM

A Pass page should clearly explain:

* what the service is
* who provides it
* how many sessions are included
* the price
* what the customer receives
* relevant Pass information
* whether the Pass has an expiration period
* what happens after purchase

The main action is purchasing the Pass.

---

## Purchasing a Pass

Customers purchase Passes using NIM.

The purchase experience should clearly show:

**10 Personal Training Sessions**

Alex Fitness

10 sessions

250 NIM

After a successful purchase, the customer owns that Pass with their own remaining sessions.

The transition from buying a Pass to seeing it in My Passes should feel extremely clear.

---

# MY PASSES

One of the most important areas of Nimpass is **My Passes**.

This is where customers see all of the Passes they currently own.

Passes may be separated into:

### Active

Passes that still contain usable sessions.

### Completed

Passes where every session has already been used.

Possibly also:

### Expired

Passes that can no longer be used.

Each pass should immediately communicate:

* service
* provider
* remaining sessions
* total sessions
* progress
* status

Example:

**Personal Training**

Alex Fitness

7 sessions remaining

3 of 10 used

Active

---

# PASS DETAIL

The Pass Detail screen is one of the core experiences of Nimpass.

A customer opening a pass should immediately understand:

**This is my pass.**

The screen should prominently display:

* service name
* provider
* active/completed status
* total sessions
* remaining sessions
* sessions already used
* progress
* expiration if applicable
* session history
* the ability to use a session

Example:

**Personal Training**

Alex Fitness

ACTIVE

# 7

sessions remaining

3 of 10 used

● ● ● ○ ○ ○ ○ ○ ○ ○

**Use Session**

View Session History

Remaining sessions should be one of the most visually important pieces of information in the entire product.

---

# USING A SESSION

When the customer attends their service, they should be able to use one of the sessions from their pass.

The experience should be very simple.

Example:

**Use a Session**

Personal Training

7 sessions available

Use one session?

After this:

**6 sessions will remain.**

The customer can then present a temporary QR code or simple session code to the provider.

The provider confirms the session.

After confirmation:

**Session used**

6 sessions remaining.

The pass updates immediately.

---

# SESSION CODE / QR

When using a session, Nimpass may display something like:

**Show this to Alex Fitness**

[ QR CODE ]

or

**812 483**

The code is temporary and represents the specific session being used.

The user does not need to understand anything technical behind this process.

It should simply feel like presenting a digital session ticket.

---

# SESSION HISTORY

Every pass should contain a clear session history.

For example:

**Session History**

September 12
Session used
7 → 6 remaining

September 8
Session used
8 → 7 remaining

September 3
Session used
9 → 8 remaining

History exists mainly to create clarity and trust.

It should be easy for both the customer and provider to understand when sessions were used.

---

# COMPLETED PASSES

When all sessions have been used, the pass becomes completed.

Example:

**Personal Training**

Alex Fitness

COMPLETED

10 of 10 sessions used

The completed pass should remain available in the customer's history.

The customer can view previous sessions and may be encouraged to:

**Buy Again**

This creates the natural Nimpass lifecycle:

**Discover → Purchase → Use → Complete → Buy Again**

---

# PROVIDER EXPERIENCE

> **Superseded by `DECISIONS.md` ADR-008.** There is no workspace and no
> sidebar. Creating a Pass is the provider experience: one form, reached in one
> press, that names its own service and carries its own publish step. The
> Provider Overview and Session Confirmation sections below describe surfaces
> that no longer exist.

Professionals have their own Nimpass workspace.

This side of the product is for people such as:

* personal trainers
* tutors
* coaches
* instructors
* consultants
* wellness professionals
* independent service providers

The provider should be able to manage the important parts of their business without Nimpass feeling like complicated business software.

---

# PROVIDER OVERVIEW

The provider should have an overview showing useful information about their Nimpass activity.

Possible information includes:

* active passes
* passes sold
* sessions completed
* recent activity
* NIM received

For example:

**Overview**

Active Passes
24

Sessions This Month
83

Passes Sold
31

NIM Received
4,850 NIM

Recent Activity

The emphasis should be on useful operational information rather than complicated analytics.

---

# SERVICES

Providers should be able to create and manage the services they offer.

Example:

**Personal Training**

3 Passes

**Nutrition Coaching**

2 Passes

A service acts as the main category under which Passes are created.

---

# PASSES

Providers should be able to create multiple Passes for their services.

For example:

Personal Training

**5 Personal Training Sessions**
5 sessions
140 NIM

**10 Personal Training Sessions**
10 sessions
250 NIM

**20 Personal Training Sessions**
20 sessions
450 NIM

Passes can be active, unpublished or otherwise unavailable depending on their current state.

---

# CREATE A PASS

Creating a Pass should be straightforward.

The provider needs to define things such as:

* service
* Pass name
* number of sessions
* price
* description
* expiration if applicable
* image or visual identity if desired

Example:

**Create Pass**

Service
Personal Training

Pass Name
10 Personal Training Sessions

Sessions
10

Price
250 NIM

Description
10 private one-to-one personal training sessions.

Expiration
No expiration

**Publish Pass**

---

# PROVIDER PASSES

> **Not implemented, and blocked on the backend.** `backend/openapi.yaml`
> exposes one pass endpoint, `GET /passes/{passID}`, scoped to the pass owner.
> There is no provider-side list of sold passes, so this section describes a
> capability the contract cannot serve yet.

Providers should be able to see passes purchased from them.

A provider might see:

* customer
* Pass
* remaining sessions
* total sessions
* pass status
* recent session activity

The main purpose is understanding who currently owns active session Passes and how much usage remains.

---

# SESSION CONFIRMATION

> **Superseded by `DECISIONS.md` ADR-007.** The provider does not verify or
> confirm anything. The customer uses a session from their own pass and confirms
> it in their wallet; the counts below are what *they* see, on their own screen.

When a customer wants to use a session, the provider should be able to verify and confirm it.

The provider may:

* scan the customer's QR code
* enter the customer's temporary session code
* open the pending session request

The provider should clearly see:

* which service is being used
* which Pass it belongs to
* how many sessions currently remain
* what will remain after confirmation

Then the provider confirms the session.

The pass is updated for both sides.

---

# ACTIVITY

Providers should have a simple activity history showing meaningful actions such as:

* Pass purchased
* session used
* pass completed
* new active pass

This should behave more like an understandable timeline than a complicated analytics system.

---

# PUBLIC SHARING

Providers should be able to share:

* their public Nimpass profile
* individual services
* individual Passes

A trainer, tutor or coach should be able to send someone a direct Nimpass link and allow that person to understand and purchase the Pass.

---

# CORE OBJECTS INSIDE NIMPASS

The entire product revolves around a small number of understandable objects:

**Provider**

The professional offering the service.

**Service**

What the professional does.

**Pass**

A purchasable product containing a number of sessions. Providers create and publish Passes. Customers buy them.

**My Pass / Purchased Pass**

The customer's owned copy of a Pass, with independent remaining sessions.

**Session**

One unit of usage from that pass.

**Session History**

The record of how the pass has been used.

These concepts should remain extremely easy to understand throughout the product.

---

# THE MOST IMPORTANT USER JOURNEY

The central Nimpass customer journey is:

**Discover**

↓

Find a professional

↓

Explore their service

↓

Choose a Pass

↓

Purchase the Pass

↓

Receive a Nimpass

↓

See remaining sessions

↓

Attend a session

↓

Use one session

↓

See the pass update

↓

Repeat over time

↓

Complete the pass

↓

Buy again

The design should make this lifecycle feel natural from beginning to end.

---

# PRODUCT CHARACTER

Nimpass should feel like a modern consumer service platform rather than financial software.

The product is fundamentally about:

**people, professionals, services, Passes, passes and sessions.**

Payment enables the experience, but payment is not the experience itself.

The digital pass should become the emotional center of the product.

A customer should care primarily about:

**“I bought 10 sessions. I have 7 left.”**

Not about the underlying payment or technology.

Design the entire web application around making that concept beautifully simple.
