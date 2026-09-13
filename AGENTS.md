# Nimpass — Codex Project Instructions

Nimpass is a web-first Nimiq Mini App.

This repository contains authoritative project documentation under `/docs`.
Before implementing, modifying, refactoring, or reviewing any feature, you MUST
understand and follow the relevant project documentation.

Do not make product, architecture, UX, Nimiq integration, security, or competition
strategy decisions based only on assumptions.

---

# 1. Mandatory Project Context

The following documents define the Nimpass product and are authoritative:

1. `docs/01-PRODUCT.md`
   - Product vision
   - Target users
   - Core problem
   - Product scope
   - Web-first strategy

2. `docs/02-USER-FLOWS.md`
   - User journeys
   - Provider/customer flows
   - Session pass lifecycle
   - Navigation expectations

3. `docs/03-DESIGN-SYSTEM.md`
   - UI/UX rules
   - Layout principles
   - Components
   - Visual language
   - Luma-inspired design direction

4. `docs/04-NIMIQ-MINI-APPS.md`
   - Nimiq Mini App platform requirements
   - Mini App environment
   - Integration constraints

5. `docs/05-NIMIQ-PAY-INTEGRATION.md`
   - Nimiq Pay integration
   - Wallet/payment flows
   - Payment success/failure/cancellation behavior
   - NIM-related functionality

6. `docs/06-COMPETITION.md`
   - Mini Apps Competition requirements
   - Competition constraints
   - Judging expectations

7. `docs/07-SCORING-STRATEGY.md`
   - 100-point judging strategy
   - Functionality/reliability/usefulness priorities
   - Nimiq integration priorities
   - Real usage strategy
   - Presentation/polish priorities

8. `docs/08-ARCHITECTURE.md`
   - Frontend/backend boundaries
   - Technical architecture
   - Data ownership
   - API responsibilities
   - Infrastructure decisions

9. `docs/09-SECURITY.md`
   - Security requirements
   - Authentication/authorization rules
   - Payment/security boundaries
   - Input validation
   - Abuse prevention

10. `docs/10-SUBMISSION-CHECKLIST.md`
    - Competition submission readiness
    - Final verification requirements

11. `docs/DECISIONS.md`
    - Accepted architectural/product decisions
    - Decisions in this file MUST NOT be silently reversed.

12. `docs/README.md`
    - Documentation map and additional project context.

---

# 2. Required Reading Behavior

Before starting a development task:

1. Determine which documentation files are relevant.
2. Read those files before editing code.
3. For large features or architectural changes, read ALL documents listed above.
4. Check `docs/DECISIONS.md` before introducing a new architectural pattern.
5. Check `docs/09-SECURITY.md` for any feature involving:
   - authentication
   - wallet identity
   - Nimiq Pay
   - payments
   - QR codes
   - session redemption
   - user-generated input
   - API endpoints
   - authorization

Do not treat these documents as optional background information.

They are project requirements.

---

# 3. Source of Truth

When implementation and documentation disagree:

DO NOT silently choose the implementation.

First determine whether:

- the implementation is outdated,
- the documentation is outdated,
- or there is a genuine conflict.

Report the conflict before making a destructive or architecture-changing decision.

`docs/DECISIONS.md` has priority for explicitly recorded project decisions.

The product and architecture documents define intended behavior.

---

# 4. Product Principle

Nimpass is WEB-FIRST.

Desktop or mobile assumptions must not override the web-first product strategy.

The application should work especially well:

- in modern desktop browsers,
- in mobile browsers,
- and inside the Nimiq Pay / Mini App environment where applicable.

Responsive behavior is required, but the project architecture should not be
redesigned as a native-mobile-first product unless explicitly requested.

---

# 5. Design Principle

The primary design reference is Luma.

Do not copy Luma branding or assets.

Use it as inspiration for:

- visual simplicity,
- information hierarchy,
- whitespace,
- event/pass presentation,
- navigation clarity,
- restrained interfaces,
- polished product feel.

Follow `docs/03-DESIGN-SYSTEM.md` for concrete rules.

Do not introduce arbitrary UI patterns that contradict the design system.

---

# 6. Nimiq Principle

Nimiq integration is a core product capability, not a decorative payment option.

When implementing wallet/payment functionality:

- follow `docs/04-NIMIQ-MINI-APPS.md`;
- follow `docs/05-NIMIQ-PAY-INTEGRATION.md`;
- account for success, cancellation, failure and retry states;
- never fake payment completion;
- clearly separate client-side display state from verified backend state;
- preserve competition compliance.

---

# 7. Competition Principle

The project is being built for the Nimiq Mini Apps Competition.

Implementation decisions should consider the judging criteria documented in:

- `docs/06-COMPETITION.md`
- `docs/07-SCORING-STRATEGY.md`
- `docs/10-SUBMISSION-CHECKLIST.md`

However:

Do not sacrifice product correctness, security, or maintainability merely to
simulate competition functionality.

The app must feel like a real usable product.

---

# 8. Engineering Behavior

Before writing new code:

- inspect the existing implementation;
- reuse existing abstractions where appropriate;
- avoid duplicate systems;
- understand frontend/backend boundaries;
- check existing dependencies before adding new ones.

Do not add a dependency when the existing stack already solves the problem
reasonably.

Do not rewrite working architecture without a concrete reason.

Prefer small, reviewable changes.

---

# 9. Frontend

When working under `/frontend`:

Read at minimum:

- `docs/01-PRODUCT.md`
- `docs/02-USER-FLOWS.md`
- `docs/03-DESIGN-SYSTEM.md`

If the feature involves Nimiq:

also read:

- `docs/04-NIMIQ-MINI-APPS.md`
- `docs/05-NIMIQ-PAY-INTEGRATION.md`

Frontend implementation must respect the documented web-first strategy.

---

# 10. Backend

When working under `/backend`:

Read at minimum:

- `docs/08-ARCHITECTURE.md`
- `docs/09-SECURITY.md`
- `docs/DECISIONS.md`

For Nimiq/payment functionality also read:

- `docs/04-NIMIQ-MINI-APPS.md`
- `docs/05-NIMIQ-PAY-INTEGRATION.md`

Never trust client-reported payment/session state when server-side verification
is required.

---

# 11. Before Implementing a Feature

For any non-trivial feature, briefly establish:

- which requirement it implements;
- which docs govern it;
- which frontend areas are affected;
- which backend areas are affected;
- whether Nimiq integration is affected;
- whether security rules apply;
- how the feature will be tested.

Then implement.

Do not create unnecessary planning documents unless requested.

---

# 12. After Implementing

Before declaring a task complete:

- run relevant tests;
- run lint/type checks where available;
- verify affected user flows;
- verify error states;
- verify loading/empty/success/failure states where applicable;
- check relevant documentation requirements;
- report any unresolved mismatch or limitation.

Do not claim success if verification has not actually been performed.

---

# 13. Documentation Updates

If implementation introduces an intentional product or architecture decision
not already documented:

propose an update to `docs/DECISIONS.md`.

Do not silently change foundational project decisions.

If an implementation changes documented behavior, update the appropriate
documentation as part of the task when explicitly authorized.

---

# 14. Development Priority

Unless a task explicitly says otherwise, optimize in this order:

1. Correctness
2. Security
3. Core user flow
4. Nimiq integration correctness
5. Reliability and error handling
6. Usability
7. Competition score impact
8. Visual polish
9. Secondary enhancements

---

# 15. Important Rule

Do not start coding merely because a requested feature sounds obvious.

Inspect the repository and relevant documentation first.

Nimpass documentation is part of the implementation contract.