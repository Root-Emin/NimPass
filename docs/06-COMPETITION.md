# Nimpass — Nimiq Mini Apps Competition

> **Document type:** Competition rules and compliance source of truth
> **Project:** Nimpass
> **Competition:** Nimiq Mini Apps Competition
> **Current target:** Cycle II
> **Last verified:** 2026-09-13
> **Status:** Active
> **Audience:** Developers, AI coding agents, designers, product contributors
> **Primary purpose:** Ensure every Nimpass product, technical, UX, security, submission, and promotion decision remains compatible with the Nimiq Mini Apps Competition requirements.

---

# 1. Critical Rule

This document summarizes competition requirements for Nimpass.

However:

> **Official Nimiq Mini Apps Competition rules always override this document.**

Competition rules may change between cycles.

Before making a competition-critical decision, consult the official sources.

Primary official sources:

```text
https://miniappscompetition.com/

https://miniappscompetition.com/rules

https://miniappscompetition.com/scoring

https://miniappscompetition.com/faq

https://miniappscompetition.com/submissions

https://nimiq.dev/mini-apps
```

If this document conflicts with an official rule:

```text
OFFICIAL RULE
    ↓
wins over
    ↓
THIS DOCUMENT
```

Update this document afterward.

---

# 2. What Is the Nimiq Mini Apps Competition?

The Nimiq Mini Apps Competition is a competition for builders creating usable applications using the **Nimiq Pay Mini Apps Framework**.

The goal is not merely to produce a blockchain demo.

The expected result is a functioning application that:

* solves a real problem or provides useful entertainment,
* works reliably,
* integrates meaningfully with Nimiq Pay,
* can be used by real people,
* feels complete,
* provides a polished user experience.

Competition cycles last approximately four weeks.

Entries are evaluated by the **Nimiq Community Council**.

The competition awards prizes in USDT.

---

# 3. Competition Philosophy

The competition strongly rewards:

```text
Working Product
+
Real Usefulness
+
Meaningful Nimiq Integration
+
Real Users
+
Good UX
+
Builder Activity
```

It does NOT reward complexity for its own sake.

A focused application that:

* works,
* solves a real problem,
* has real users,
* integrates Nimiq well,
* feels polished,

can outperform a larger but unfinished application.

This principle is important for Nimpass.

Do not sacrifice core reliability to build unnecessary features.

---

# 4. Current Target Cycle

Nimpass is currently targeting:

```text
Nimiq Mini Apps Competition
Cycle II
```

Official Cycle II period:

```text
Start:
August 24, 2026

Deadline:
September 18, 2026

Deadline time:
23:59 UTC

Duration:
4 weeks
```

Submission before the deadline is mandatory.

Late Cycle II submissions are not scored.

---

# 5. Competition Timeline

The published competition timeline is:

```text
Registration

June 3
Registration Dashboard opens


Cycle I

July 6 – July 31, 2026


Cycle II

August 24 – September 18, 2026


Cycle III

October 5 – October 30, 2026
```

Each competition cycle lasts approximately four weeks.

Nimpass currently targets Cycle II.

---

# 6. Cycle II Community Calls

Cycle II includes weekly **Sip & Ship** community calls.

Published Cycle II dates:

```text
August 26
September 2
September 9
September 16
```

Officially listed time:

```text
1:00–2:30 PM EST
```

These calls are not mandatory.

However, they are useful for:

* technical questions,
* product feedback,
* testing,
* community participation,
* presenting progress,
* discovering issues before judging.

Competition participation should not be treated purely as coding.

Community feedback is part of the process.

---

# 7. Eligibility

Participants must satisfy competition eligibility requirements.

Core requirements include:

```text
Age:
18+

Participation:
Individual or team

Maximum team size:
5 people

Submission limit:
1 Mini App per team per cycle
```

Participation is generally open worldwide except where prohibited by applicable restrictions and sanctions.

Prize payments cannot be made to participants in OFAC-sanctioned jurisdictions.

Winners may be required to demonstrate eligibility.

---

# 8. Team Rules

Teams may contain up to five people.

A team must designate one lead.

The team lead is responsible for:

* competition communication,
* submission representation,
* payout coordination.

Competition submission information may require:

* name or pseudonym,
* GitHub profile,
* Nimiq wallet address.

Prizes are awarded to the team rather than separately to each team member.

Internal prize distribution is the team's responsibility.

---

# 9. GitHub Requirement

Competition submissions require a public GitHub repository.

Nimpass therefore must have:

```text
Public repository
+
Accessible source code
+
MIT License
```

A private production repository with only screenshots or binaries is not sufficient.

---

# 10. License Requirement

Competition code must be published under:

```text
MIT License
```

Nimpass must therefore contain an appropriate:

```text
LICENSE
```

file before submission.

Do not postpone this until after judging.

---

# 11. Ownership

Publishing Nimpass under the MIT License does not mean the competition takes ownership of Nimpass.

Builders retain ownership of:

* the application,
* source code,
* product,
* intellectual property.

However, the submitted code is released under the MIT License.

The implications of that license must be understood before submission.

---

# 12. What Counts as a Mini App?

A competition entry must be built using the **Nimiq Pay Mini Apps Framework**.

A Mini App is fundamentally a web application that can run inside Nimiq Pay and interact with wallet functionality through the supported provider infrastructure.

Merely loading an ordinary website inside the Nimiq Pay WebView is not enough.

There must be meaningful integration with the wallet/provider environment.

---

# 13. Required Nimiq Integration

Competition submissions must integrate with Nimiq Pay and support at least one qualifying asset:

```text
NIM

or

USDT

or

both
```

Nimpass uses:

```text
NIM
```

as its primary payment asset.

This directly satisfies the asset direction of the product.

---

# 14. Logo Is Not Integration

This is an important competition rule.

The following does NOT qualify as Nimiq integration:

```text
Display Nimiq logo
        ↓
Use unrelated application
```

The Mini App must meaningfully use:

* Nimiq wallet functionality,
* transactions,
* payment infrastructure,
* supported wallet interactions.

Integration must be part of the actual product experience.

---

# 15. Nimpass Integration Principle

Nimpass is particularly well suited to the competition because Nimiq functionality can be part of the actual product loop.

Conceptually:

```text
Pass
   ↓
NIM Payment
   ↓
Pass Creation
   ↓
Wallet-associated Ownership
   ↓
Repeated Usage
   ↓
Authorized Session Redemption
```

Therefore Nimiq should not be added as decoration.

It participates in the product lifecycle.

---

# 16. Web-First Does Not Mean Nimiq-Pay-Optional

Nimpass is intentionally:

```text
WEB-FIRST
RESPONSIVE
```

as defined in:

```text
01-PRODUCT.md
03-DESIGN-SYSTEM.md
```

However, competition requirements add another mandatory condition:

> **Nimpass must also work properly inside Nimiq Pay.**

The correct relationship is:

```text
Web-first product
+
Responsive web application
+
Excellent Nimiq Pay Mini App support
```

Not:

```text
Web application
+
Nimiq Pay support ignored
```

---

# 17. Desktop vs Competition Runtime

Nimpass may provide an excellent desktop web experience.

That is encouraged by our product strategy.

However, judges specifically evaluate the Mini App experience.

Therefore critical Nimpass flows must also work properly inside Nimiq Pay.

Especially:

```text
Open Nimpass

View Pass

Connect / Access Wallet Context

Buy with NIM

Payment Success

Payment Cancellation

Payment Failure

View Pass

Redeem / Authorize Session

Return to Pass
```

These cannot exist only on desktop.

---

# 18. Nimiq Pay Mobile Compatibility

The scoring criteria explicitly consider how well the application works inside **Nimiq Pay on mobile**.

Therefore:

```text
web-first
```

does NOT mean:

```text
desktop-only
```

Critical competition flows must be manually tested inside the real Nimiq Pay environment.

Responsive browser testing alone is not enough.

---

# 19. Official Mini App Architecture

Nimiq Pay Mini Apps run inside a WebView.

Wallet functionality is provided through injected providers.

For Nimiq functionality, the recommended SDK initialization mechanism is conceptually:

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init()
```

Sensitive wallet operations are mediated by Nimiq Pay.

Private keys must never become available to Nimpass.

Detailed integration requirements belong in:

```text
04-NIMIQ-MINI-APPS.md

05-NIMIQ-PAY-INTEGRATION.md
```

---

# 20. Finished Product Requirement

Competition submissions must be:

```text
FUNCTIONAL
USABLE
COMPLETE ENOUGH FOR REAL USERS
```

The competition explicitly rejects the idea that a submission can simply be:

```text
prototype

mockup

design concept

non-functional demo
```

Nimpass must work end-to-end.

---

# 21. "Works on First Try" Requirement

A competition user should be able to open Nimpass and successfully understand/use it without developer intervention.

The core Nimpass promise should work:

```text
Open Nimpass
    ↓
Understand Product
    ↓
View Pass
    ↓
Purchase with NIM
    ↓
Receive Pass
    ↓
Use Pass
```

The reviewer must not need:

* manual database changes,
* developer console commands,
* custom setup,
* personal explanation from the builder,
* fake payment simulation presented as production functionality.

---

# 22. Repository Security

The public competition repository must never contain:

* private keys,
* seed phrases,
* passwords,
* production secrets,
* API secrets,
* sensitive credentials.

Secrets must use appropriate environment/configuration mechanisms.

Competition publication makes repository security especially important because the repository is public.

---

# 23. Originality and Attribution

Competition code must either:

```text
be original
```

or:

```text
use external code according to its license
and provide required attribution
```

Open-source libraries are allowed.

Templates are allowed.

AI-generated code is allowed.

But licensing obligations remain.

---

# 24. AI Tools Are Allowed

Builders may use AI coding tools.

Examples include:

* Claude,
* ChatGPT,
* Cursor,
* GitHub Copilot,
* v0,
* other AI development tools.

There is no competition penalty merely for using AI.

The final result is what matters.

AI assistance does not remove responsibility for:

* code quality,
* licensing,
* security,
* correctness,
* functionality.

---

# 25. Submission Portal

Submissions are made through the official competition submission flow / Registration Dashboard.

The competition submission process may use GitHub authentication and the official competition repository workflow.

Nimpass must be submitted before the Cycle II deadline.

---

# 26. Submission Description

A submission requires a written description.

Maximum:

```text
250 words
```

The description should clearly explain:

```text
What does Nimpass do?

Who is Nimpass for?

How does Nimpass use Nimiq Pay?
```

This description should be written for humans rather than as technical documentation.

---

# 27. Nimpass Submission Story

The eventual Nimpass submission should communicate roughly:

```text
Problem

Independent service providers sell multi-session
Passes but often track remaining sessions manually.


Solution

Nimpass turns a prepaid service Pass into a
persistent digital session pass.


Nimiq

Customers purchase Passes in NIM through
Nimiq Pay, receive their pass, and use wallet-linked
functionality throughout the pass lifecycle.


Repeat Value

Customers return each time they consume a session.
```

The final wording will be prepared separately.

---

# 28. Demo Video

A demo video or walkthrough is not mandatory according to the published rules.

However, it is encouraged.

It can strengthen the story of the application.

A Nimpass demo should eventually demonstrate:

```text
Provider Pass

↓

Customer Purchase

↓

Nimiq Pay

↓

Pass Creation

↓

Remaining Sessions

↓

Session Redemption

↓

Updated Pass
```

Do not create a demo that shows only static UI screens.

Show the actual product loop.

---

# 29. Early Access

Submissions become public around the beginning of Week 3 for early-access testing.

This is intentional.

The competition encourages:

```text
ship
↓
collect feedback
↓
fix
↓
improve
```

The first public version therefore does not have to be frozen permanently.

But it must already be usable.

---

# 30. Submission Does Not Mean Development Freeze

For Cycle II, submitting before the deadline does not permanently freeze the application.

Builders may continue:

* improving,
* fixing,
* updating,
* promoting,

after initial submission, subject to competition rules and judging timing.

Therefore:

```text
SUBMITTED
≠
STOP DEVELOPMENT
```

However, missing the official deadline is not allowed.

---

# 31. App Availability During Judging

Nimpass should remain live and functional throughout evaluation.

Significant downtime may:

* hurt the score,
* prevent judges from testing,
* affect prize eligibility.

Production availability therefore matters.

---

# 32. Competition Scoring

Maximum score:

```text
100 points
```

Current Cycle II score structure:

```text
45 pts
Functionality, Reliability & Usefulness

25 pts
Nimiq Pay & Nimiq Integration

15 pts
Real Usage

10 pts
Design & UX

 5 pts
Builder Promotion

-------------------------------

100 pts
```

This scoring model is binding competition context.

Detailed Nimpass optimization belongs in:

```text
07-SCORING-STRATEGY.md
```

---

# 33. 45 Points — Functionality, Reliability & Usefulness

This is the largest scoring category.

Judges evaluate the quality of the actual product.

Important dimensions include:

```text
Core Feature

Error Handling

Speed

Stability

Completeness

Real Need

Target Audience

Originality

Repeat Value
```

---

# 34. Core Feature

The main application promise must work.

For Nimpass this means the core lifecycle must genuinely function.

At minimum:

```text
Provider creates Pass

Customer views Pass

Customer pays

Pass exists

Pass persists

Session can be redeemed

Remaining sessions update correctly
```

A beautiful application whose core pass lifecycle fails will perform poorly.

---

# 35. Error Handling

Errors must be:

```text
caught
+
understandable
+
recoverable when possible
```

Nimpass must intentionally handle situations such as:

```text
Payment cancelled

Payment failed

Payment uncertain

Wallet rejection

Network failure

Invalid redemption

Expired redemption

Duplicate redemption

Completed pass

Unauthorized wallet

Backend failure
```

Crashes, blank pages, infinite loaders, or raw technical errors should not be normal outcomes.

---

# 36. Speed

Nimpass should load and respond quickly.

Avoid unnecessary:

* oversized bundles,
* blocking requests,
* huge media,
* expensive animations,
* unnecessary network dependencies.

The application should feel immediate.

---

# 37. Stability

The full flow must work end-to-end.

Avoid:

```text
dead ends

blank screens

broken navigation

stuck payment state

stuck redemption state

missing data after refresh
```

A user should be able to complete the complete product lifecycle.

---

# 38. Completeness

The Mini App should feel finished.

Do not expose:

```text
TODO buttons

Coming Soon core features

dead links

placeholder content

fake dashboards

unfinished core flows
```

Non-core future features may be excluded entirely.

A smaller complete product is better than a larger unfinished one.

---

# 39. Real Need

The application should solve an actual user problem.

Nimpass's problem statement is:

> Service providers selling prepaid multi-session services need a reliable way to sell Passes, track usage, and share a trusted remaining-session state with customers.

This is the problem.

Do not turn the competition submission into a blockchain technology showcase.

---

# 40. Clear Target Audience

A reviewer should understand Nimpass's target audience quickly.

Primary providers:

```text
Personal trainers

Private tutors

Language teachers

Coaches

Mentors

Music teachers

Wellness professionals

Other recurring service providers
```

Primary customers:

```text
People purchasing prepaid
multi-session service Passes
```

---

# 41. Originality

The competition evaluates whether the product:

* introduces a new idea,
* or meaningfully improves an existing pattern.

Nimpass should not present itself as merely:

```text
QR payment
```

or:

```text
crypto booking
```

The differentiating lifecycle is:

```text
Prepaid Pass
+
persistent pass
+
wallet-linked ownership
+
repeated session redemption
+
remaining-session history
```

---

# 42. Repeat Value

The competition explicitly rewards products that give users a reason to return.

Nimpass has natural repeat usage.

Example:

```text
Buy 10 sessions

↓

Use Session 1

↓

Return

↓

Use Session 2

↓

Return

↓

Use Session 3

↓

...

↓

Complete Pass

↓

Buy Again
```

Repeat usage must remain part of the real product rather than being artificially gamified.

---

# 43. 25 Points — Nimiq Pay & Nimiq Integration

Judges evaluate how meaningful the Nimiq integration is.

They consider:

```text
How central wallet/payment functionality
is to the product

Whether payment success is handled

Whether payment failure is handled

Whether payment cancellation is handled

Whether payment UX is clear and trustworthy

How well the app works inside Nimiq Pay on mobile

Whether NIM / the wider Nimiq ecosystem
is used beyond a superficial integration
```

This category is critical for Nimpass.

---

# 44. Nimiq Cannot Be an Afterthought

Bad competition implementation:

```text
Build entire Nimpass

↓

Add "Pay NIM" button at the end
```

Better:

```text
NIM Payment
        ↓
Pass Creation
        ↓
Wallet-associated Ownership
        ↓
Pass Access
        ↓
Authorization / Redemption
```

Nimiq should contribute meaningfully to how Nimpass works.

---

# 45. Payment States Required

Nimpass must explicitly handle:

```text
Payment Starting

Payment Awaiting User

Payment Successful

Payment Cancelled

Payment Failed

Payment State Unknown / Verifying

Pass Creation Pending

Pass Ready
```

Do not collapse all payment states into:

```text
success
vs
error
```

A financial application requires more careful state handling.

---

# 46. Payment Trust

Users must clearly understand:

```text
What am I purchasing?

Who am I paying?

How many sessions do I receive?

How much NIM am I paying?

Did the payment succeed?

Was I charged?

Did I receive my pass?
```

This is both a UX concern and competition scoring concern.

---

# 47. Wider Nimiq Ecosystem Usage

Current competition guidance gives additional value inside the Nimiq Integration category to applications using NIM or the wider Nimiq ecosystem beyond superficial payment acceptance.

Nimpass should investigate legitimate product uses of Nimiq capabilities such as:

```text
wallet identity

message signing

authorization

ownership verification

secure redemption
```

Only use these mechanisms where they genuinely improve the product.

Do not add blockchain operations merely to gain points.

---

# 48. 15 Points — Real Usage

Real usage is measured using unique Nimiq wallets opening the Mini App during the relevant measurement period.

Current Cycle II scoring:

```text
25+ users
→ 15 points

11–24 users
→ 10 points

4–10 users
→ 6 points

0–3 users
→ 0 points
```

The practical maximum target is therefore:

```text
25+ legitimate unique users
```

---

# 49. No Fake Usage

Bot-like traffic is excluded.

Attempting to manipulate usage metrics can result in disqualification.

Never:

* generate fake wallets to inflate usage,
* automate fake visitors,
* buy bot traffic for scoring,
* manipulate analytics,
* ask code to imitate multiple real users.

Real usage must be real.

---

# 50. 10 Points — Design & UX

Design and UX scoring considers whether the application is:

```text
clean

consistent

trustworthy
```

A first-time user should be able to understand and reach the application's main value within approximately:

```text
60 seconds
```

without needing external instructions.

Nimpass design requirements are defined in:

```text
03-DESIGN-SYSTEM.md
```

---

# 51. Nimpass 60-Second Test

A new user should be able to understand:

```text
What is Nimpass?

Who sells the service?

What Pass is available?

How many sessions?

How much does it cost?

What happens after purchase?
```

within the first minute.

Ideally much faster.

---

# 52. 5 Points — Builder Promotion

Current Cycle II promotion scoring:

```text
2 points

Post the Mini App in the
Mini Apps Competition Skool community
at least once.


3 points

Publish at least one public social media
post about the Mini App and the competition.
```

Submission may require direct links proving these activities.

Do not wait until the final minute to create them.

---

# 53. Promotion Is Part of the Competition

Promotion is not optional if the goal is a maximum score.

The competition explicitly rewards builders who:

* share progress,
* communicate their product,
* interact with the community,
* attract real users.

This does not require an existing large audience.

It requires demonstrated effort.

---

# 54. Performance Evaluation Levels

Judging uses qualitative performance levels.

Conceptually:

```text
Outstanding

Strong

Competent

Developing

Insufficient

Not Demonstrated
```

The target for competition-critical Nimpass functionality should be:

```text
OUTSTANDING
```

or at minimum:

```text
STRONG
```

Do not intentionally ship core functionality at bare-minimum quality.

---

# 55. Outstanding

Outstanding means execution that effectively sets the competition standard.

For Nimpass this should imply:

* reliable core flow,
* thoughtful edge cases,
* polished UX,
* clear value,
* meaningful Nimiq integration,
* real usage,
* production-quality presentation.

---

# 56. Strong

Strong means:

```text
polished
thoughtful
above expectation
```

A feature that merely works may not automatically qualify as strong.

---

# 57. Prizes — Cycle II

Published Cycle II prize pool:

```text
$17,000 USDT
```

Prize structure:

```text
1st Place
$10,000 USDT

2nd Place
$5,000 USDT

3rd Place
$2,000 USDT
```

Prizes are awarded per team.

---

# 58. Prize Payout Currency

Competition prizes are paid in:

```text
USDT
```

to the Nimiq wallet information provided through the competition process.

Builders remain responsible for applicable tax obligations.

---

# 59. Payout Milestones

Winner payouts are distributed across multiple monthly milestones rather than necessarily being paid entirely at once.

Published FAQ guidance describes three installments.

Conceptually:

```text
Month 1
Winner announced
App live
Prize terms accepted

↓

Month 2
App still live
Critical issues addressed
Community feedback handled

↓

Month 3
App still live
Meaningful update delivered
Status / next-step summary provided
```

Failure to satisfy a milestone may forfeit that installment.

Previous paid installments are not automatically clawed back.

---

# 60. Post-Competition Maintenance

Winning Mini Apps are expected to remain maintained and available after the competition.

Published guidance expects winners to maintain their Mini App for approximately:

```text
12 months
```

The goal is to create real products rather than temporary competition demos.

Nimpass architecture should therefore avoid shortcuts that make ongoing maintenance impossible.

---

# 61. Re-Entry Rules

Previous winners may enter later cycles with:

```text
a new Mini App
```

but cannot resubmit the same winning Mini App.

Previous non-winning projects may enter a later cycle when they contain significant:

```text
improvements

or

new functionality
```

---

# 62. Conduct

Participants are expected to engage respectfully in competition spaces.

This includes:

* calls,
* community discussions,
* forums,
* official channels.

Serious abusive behavior can lead to disqualification.

Competition conduct requirements apply even outside the application code itself.

---

# 63. Liability

Builders are responsible for:

* functionality,
* security,
* legal compliance,
* application behavior.

Entering the competition does not transfer those responsibilities to Nimiq.

Nimpass must therefore treat security and compliance as product requirements.

---

# 64. What's Off-Limits

The official competition rules prohibit several classes of content and behavior.

These restrictions are mandatory.

---

# 65. Undisclosed User Data Collection

Do not collect, store, or transmit user data without appropriate:

```text
disclosure

lawful basis

informed consent
```

Nimpass must minimize data collection.

Any information that is collected must have a clear product purpose.

---

# 66. Framework Violations

Nimpass must not violate the Nimiq Pay Mini Apps Framework terms or technical standards.

Do not attempt to:

* bypass wallet confirmations,
* circumvent host security,
* access private keys,
* abuse injected providers,
* bypass permissions.

---

# 67. Fraud and Deception

Forbidden:

```text
phishing

false claims

misleading UX

fraudulent functionality

deceptive payment behavior
```

This is especially important for Nimpass because it processes payments.

---

# 68. Misleading Financial UX

Never display:

```text
Payment successful
```

unless the system has an appropriate basis for that state.

Never imply:

```text
You were not charged
```

unless the application can reliably establish that fact.

Never fabricate:

* wallet state,
* transaction state,
* pass ownership.

---

# 69. Malware and Hidden Functionality

Forbidden:

* malware,
* spyware,
* malicious code,
* hidden functionality.

Everything security-sensitive in Nimpass should be intentional and auditable.

---

# 70. Illegal Activity

Nimpass must not contain functionality that facilitates or promotes illegal activity under applicable law.

Providers and services supported by Nimpass must therefore remain within lawful use cases.

---

# 71. Harmful Content

Competition rules prohibit content including relevant categories of:

* sexually exploitative material,
* violence promotion,
* hate speech,
* harassment,
* discrimination.

Nimpass provider/service content must respect these restrictions.

---

# 72. Impersonation

Nimpass must not impersonate:

* people,
* companies,
* brands,
* products,

without authorization.

Provider identity and branding should not intentionally mislead customers.

---

# 73. Gambling

Random-outcome gambling and games of chance involving prohibited competition behavior are not allowed.

Skill-based games with clearly defined rules may be allowed by competition rules.

This currently has no meaningful connection to Nimpass.

Do not introduce betting functionality.

---

# 74. Third-Party Rights

Do not use:

* copyrighted assets,
* third-party code,
* trademarks,
* images,
* templates,

without appropriate rights, licensing, or attribution.

This applies to the entire Nimpass repository and public application.

---

# 75. Luma Design Reference and Competition IP Rules

Nimpass uses:

```text
Luma
```

as a visual and UX inspiration.

This is permitted only as inspiration.

Do NOT:

```text
copy Luma source code

copy proprietary assets

copy Luma branding

copy logos

replicate screens pixel-for-pixel

pretend Nimpass is affiliated with Luma
```

The goal is:

```text
Luma-inspired design philosophy
```

not:

```text
Luma clone
```

This distinction is important because competition rules prohibit plagiarism and unauthorized use of third-party assets.

---

# 76. No Plagiarism

Competition rules prohibit:

```text
copying

plagiarism

substantially similar submissions
```

Forks are only acceptable when appropriately licensed and significantly modified.

Nimpass must remain recognizably its own product.

---

# 77. Nimpass Competition Compliance Map

Nimpass should satisfy the competition as follows:

```text
Real problem
→ Manual prepaid session tracking

Clear audience
→ Recurring service providers + customers

Core feature
→ Digital multi-session pass

Nimiq
→ NIM payment and wallet-linked functionality

Repeat value
→ Every service session brings the user back

Design
→ Luma-inspired polished web product

Real usage
→ Real providers / customers test the product

Promotion
→ Skool + public social post
```

---

# 78. Competition-Critical Nimpass Flow

The most important competition demo path is:

```text
Provider creates Pass
        ↓
Pass becomes available
        ↓
Customer opens Pass
        ↓
Customer understands offer
        ↓
Customer pays with NIM
        ↓
Payment is confirmed
        ↓
Customer receives pass
        ↓
Customer sees remaining sessions
        ↓
Session redemption occurs
        ↓
Remaining count decreases
        ↓
History updates
```

This must work reliably before lower-priority features are considered.

---

# 79. Competition Failure Conditions for Nimpass

The following would seriously damage competition performance:

```text
Payment button does nothing

Payment cannot be cancelled gracefully

Payment fails with raw error

Pass is created after failed payment

Pass disappears after refresh

Session can be redeemed twice

Remaining sessions become incorrect

Nimiq Pay mobile layout breaks

User cannot understand what Nimpass does

No real users

Public GitHub repository missing

MIT License missing

Secrets committed to repository

Broken production URL

Submission after deadline
```

Treat these as critical issues.

---

# 80. Competition Acceptance Test

Before Nimpass is considered competition-ready, a completely new tester should be able to:

```text
1. Open the application.

2. Understand what Nimpass does.

3. Find a service Pass.

4. Understand the provider.

5. Understand session quantity.

6. Understand price.

7. Start NIM payment.

8. Cancel safely.

9. Retry.

10. Complete payment.

11. Receive a pass.

12. Close Nimpass.

13. Return.

14. Find the same pass.

15. See remaining sessions.

16. Redeem one session.

17. See the count decrease exactly once.

18. View history.

19. Continue using the pass.
```

This should be possible without help from the developer.

---

# 81. Mandatory Environment Test

Do not validate Nimpass only through:

```text
desktop browser
```

Competition-critical testing must include:

```text
Desktop web

Responsive browser

Real mobile viewport

Nimiq Pay Mini App environment

NIM test transaction

Payment cancellation

Payment failure / error path

Return visit

Redemption
```

---

# 82. Production Readiness

Before submission, Nimpass must have:

```text
Live production URL

Public GitHub repository

MIT License

Working Nimiq integration

No committed secrets

Working core lifecycle

Useful error states

Responsive design

Working Nimiq Pay experience

Submission description

Competition promotion evidence
```

---

# 83. Competition Priority Rule

Competition development priorities should be:

```text
P0
Core feature correctness

P0
Payment correctness

P0
Pass correctness

P0
Redemption correctness

P0
Nimiq Pay compatibility

P0
No disqualifying rule violations


P1
Polish

P1
Design

P1
Real-user feedback

P1
Performance

P1
Promotion


P2
Additional features
```

Do not build P2 functionality while P0 functionality remains unreliable.

---

# 84. Submission Deadline Rule

For Cycle II:

```text
September 18, 2026
23:59 UTC
```

is a hard submission deadline.

Do not plan submission for the final minute.

Nimpass should be submitted while enough time remains to recover from:

* authentication issues,
* GitHub issues,
* deployment issues,
* submission form issues,
* production bugs.

---

# 85. Real User Rule

Because real usage directly contributes points, competition readiness is not achieved merely when development is complete.

Conceptually:

```text
CODE COMPLETE
≠
COMPETITION COMPLETE
```

Competition completion also requires:

```text
Real users

Real testing

Real feedback

Public promotion
```

The detailed acquisition strategy belongs in:

```text
07-SCORING-STRATEGY.md
```

---

# 86. Documentation Rule for Claude / AI Agents

AI coding agents must not treat competition requirements as optional suggestions.

Before implementing a major feature, an agent should determine:

```text
Does this affect eligibility?

Does this affect Nimiq integration?

Does this affect reliability?

Does this introduce a prohibited pattern?

Does this affect public repository security?

Does this improve or damage the competition-critical flow?
```

If uncertain about current competition rules, consult official documentation rather than inventing requirements.

---

# 87. No Fake Competition Features

Do not add features solely because they sound impressive to judges.

Bad reasoning:

```text
Let's add blockchain X
because judges like blockchain.
```

Better reasoning:

```text
Does blockchain X make the
Nimpass experience better?
```

Competition optimization must reinforce the product.

It must not distort it.

---

# 88. Competition vs Product Rule

If a competition opportunity conflicts with the fundamental Nimpass product:

1. determine whether the feature genuinely improves Nimpass,
2. avoid short-term gimmicks,
3. protect core usability,
4. protect security,
5. protect product identity.

The goal is:

```text
excellent Nimpass
+
excellent competition entry
```

not:

```text
competition gimmick
+
weak product
```

---

# 89. Rule Change Policy

Competition rules may change.

Therefore this file is time-sensitive.

At the top of this document:

```text
Last verified: 2026-09-13
```

must be updated whenever competition rules are rechecked.

Before submission, verify at minimum:

```text
rules page

scoring page

FAQ

submission portal

official announcements
```

Do not rely solely on an old version of this file.

---

# 90. Official Source Priority

Competition information should be trusted in this order:

```text
1. Official current competition rules

2. Official scoring page / official scoring announcement

3. Official submission portal

4. Official competition FAQ

5. Official Mini Apps Competition announcements

6. Nimiq Developer Center

7. This document

8. Old community discussions

9. AI assumptions
```

An AI model must never override current official competition information with older remembered information.

---

# 91. Nimiq Technical Source Priority

For technical Mini App behavior:

```text
1. https://nimiq.dev/mini-apps

2. Official Nimiq Mini App API reference

3. Official tutorials / FAQ

4. Nimpass Nimiq documentation

5. Existing implementation

6. AI assumptions
```

Never invent Nimiq APIs.

---

# 92. Current Competition Snapshot

As verified for Nimpass:

```text
Competition:
Nimiq Mini Apps Competition

Target:
Cycle II

Cycle:
August 24 – September 18, 2026

Deadline:
September 18, 2026
23:59 UTC

Maximum score:
100

Functionality / Reliability / Usefulness:
45

Nimiq Pay / Nimiq Integration:
25

Real Usage:
15

Design & UX:
10

Builder Promotion:
5

Maximum Real Usage tier:
25+ unique users

Repository:
Public GitHub

License:
MIT

Asset used by Nimpass:
NIM

Current Cycle II Prize Pool:
$17,000 USDT

First:
$10,000

Second:
$5,000

Third:
$2,000
```

---

# 93. Nimpass Competition Identity

Nimpass should be presented as:

> **A web-first digital session pass platform for recurring services, powered by Nimiq Pay and NIM.**

It allows service providers such as:

```text
personal trainers

tutors

coaches

language teachers

music teachers

wellness professionals
```

to sell prepaid multi-session Passes.

Customers purchase with NIM and receive a persistent digital pass showing exactly how many sessions remain.

Each session can be securely redeemed over time.

This creates a natural reason for users to repeatedly return to the Mini App.

---

# 94. Final Competition Principle

Nimpass should not try to win by appearing technically complicated.

It should try to win by being:

```text
USEFUL

RELIABLE

POLISHED

CLEAR

REPEATABLE

TRUSTWORTHY

DEEPLY INTEGRATED WITH NIMIQ

USED BY REAL PEOPLE
```

The competition rewards a product that actually works.

Build that product.

---

# Source-of-Truth Rule

This document is the internal Nimpass interpretation of the Nimiq Mini Apps Competition.

It is NOT more authoritative than official competition documentation.

Whenever:

```text
this file
```

conflicts with:

```text
official competition rules
```

the official rules win immediately.

The correct process is:

```text
1. Follow the official rule.

2. Update this document.

3. Update implementation if necessary.

4. Update submission strategy if necessary.
```

Never knowingly preserve an outdated competition assumption in code or documentation.

---

# Relationship to Other Documentation

```text
01-PRODUCT.md
→ What Nimpass is

02-USER-FLOWS.md
→ How users move through Nimpass

03-DESIGN-SYSTEM.md
→ How Nimpass looks and feels

04-NIMIQ-MINI-APPS.md
→ Nimiq Mini App technical environment

05-NIMIQ-PAY-INTEGRATION.md
→ Nimiq wallet/payment behavior

06-COMPETITION.md
→ Competition rules and compliance

07-SCORING-STRATEGY.md
→ How Nimpass targets the 100-point scorecard

08-ARCHITECTURE.md
→ Technical architecture

09-SECURITY.md
→ Security and trust model

10-SUBMISSION-CHECKLIST.md
→ Final submission verification
```

`06-COMPETITION.md` defines the rules.

`07-SCORING-STRATEGY.md` will define how Nimpass deliberately competes within those rules.
