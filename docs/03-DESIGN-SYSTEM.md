# Nimpass — Design System & UX Direction

> **Document type:** Visual design and UX source of truth
> **Project:** Nimpass
> **Status:** Active
> **Audience:** Developers, AI coding agents, designers, product contributors
> **Depends on:** `01-PRODUCT.md`, `02-USER-FLOWS.md`
> **Primary reference:** Luma — `https://luma.com/`
> **Primary purpose:** Define exactly how Nimpass should look, feel, behave, and adapt across web and responsive environments.

---

# 1. Design Mission

Nimpass should feel like a product that could exist in the same visual world as **Luma**.

Luma is the strongest visual and UX reference for Nimpass.

The target is not to create a generic SaaS dashboard.

The target is not to create a stereotypical Web3 application.

The target is not to create a cryptocurrency wallet interface.

The target is:

> **Luma-level simplicity, polish, hierarchy, and restraint applied to prepaid recurring services.**

Nimpass should inherit the qualities that make Luma feel refined:

* strong typography,
* generous whitespace,
* calm page composition,
* large visual surfaces,
* simple navigation,
* restrained use of borders,
* restrained use of color,
* content-first layouts,
* high-quality imagery where useful,
* clear primary actions,
* very low visual noise,
* premium but approachable presentation.

Nimpass must still have its own identity.

The goal is:

```text
Luma
   ↓
Visual / UX philosophy
   ↓
Adapted to Nimpass
   ↓
Service packages
Digital passes
Session tracking
NIM payments
Provider operations
```

---

# 2. Luma Is the Primary Reference

When there is uncertainty about how a Nimpass public-facing page should feel, use Luma as the first visual reference.

Particularly study Luma for:

* whitespace,
* typography hierarchy,
* restrained navigation,
* page width,
* image prominence,
* cards,
* event/detail page composition,
* organizer/profile pages,
* form simplicity,
* CTA hierarchy,
* content grouping,
* subtle surfaces,
* minimal decorative UI,
* responsive behavior.

Nimpass should be **as close to Luma's design philosophy as reasonably possible** while remaining appropriate for Nimpass's own product model.

---

# 3. Do Not Blindly Clone Luma

Luma is a design reference, not a component source.

Do not:

* copy Luma source code,
* copy proprietary assets,
* recreate branding,
* reproduce logos,
* reproduce distinctive illustrations,
* blindly pixel-copy an entire page.

Instead, reproduce the underlying design principles.

The desired relationship is:

```text
Luma visual grammar
+
Nimpass information architecture
+
Nimpass identity
```

not:

```text
Luma clone
+
different logo
```

---

# 4. Design Influence

The intended design influence should approximately feel like:

```text
60% Luma-style product design

25% modern service marketplace

15% digital pass / wallet interaction patterns
```

The Luma influence should dominate the visual language.

Service marketplace patterns should only help with:

* provider discovery,
* provider pages,
* packages,
* service selection.

Digital wallet/pass patterns should only help with:

* ownership,
* payment,
* wallet connection,
* pass representation,
* redemption.

Wallet design must never dominate the product.

---

# 5. Desired Emotional Character

Nimpass should feel:

* calm,
* elegant,
* warm,
* trustworthy,
* modern,
* premium,
* simple,
* polished,
* approachable,
* human,
* intentional.

It should NOT feel:

* cyberpunk,
* crypto-native,
* technical,
* noisy,
* corporate,
* enterprise-heavy,
* overly futuristic,
* gaming-oriented,
* speculative,
* finance-heavy.

A user should think:

> This feels beautifully designed.

not:

> This looks like a blockchain application.

---

# 6. Product Design Formula

The visual identity should follow:

```text
Luma simplicity
+
Service marketplace clarity
+
Premium digital pass
+
Subtle Nimiq wallet functionality
```

A useful mental model:

> **If Luma had created a product for prepaid personal training, tutoring, coaching, and recurring professional services, what might it feel like?**

That is much closer to the desired direction than:

> What does a Web3 dashboard look like?

---

# 7. Platform Strategy

Nimpass is **WEB-FIRST**.

This is a binding design decision.

The primary product design is established on:

* desktop,
* laptop.

The same system must then adapt intentionally to:

* tablet,
* mobile web,
* Nimiq Pay Mini App environments.

Do not treat desktop as a stretched phone layout.

Do not treat mobile as a squeezed desktop layout.

The system should respond structurally.

---

# 8. Platform Priority

The design priority is:

```text
1. Desktop / laptop web
2. Responsive web system
3. Tablet adaptation
4. Mobile adaptation
5. Nimiq Pay embedded compatibility
```

This does not mean mobile quality is optional.

It means the information architecture must not be artificially constrained by a phone-sized canvas.

---

# 9. Responsive Philosophy

Responsive design means preserving intent while changing composition.

Example:

Desktop provider interface:

```text
┌─────────────┬──────────────────────────────────────┐
│             │                                      │
│ Navigation  │             Content                  │
│             │                                      │
│ Overview    │    Metrics       Recent Activity     │
│ Services    │                                      │
│ Packages    │    Active Passes                     │
│ Passes      │                                      │
│             │                                      │
└─────────────┴──────────────────────────────────────┘
```

Mobile:

```text
Overview

Active Passes
24

Packages
3

Recent Activity
...

[ Validate Session ]
```

Same product.

Different composition.

---

# 10. Breakpoint Philosophy

Do not design around arbitrary devices.

Design around when layouts stop working.

Conceptually:

```text
Large desktop
≥ 1440 px

Desktop / laptop
1024–1439 px

Tablet
768–1023 px

Mobile
< 768 px
```

These values are implementation guidance, not immutable business rules.

Tailwind breakpoints may be used where appropriate.

---

# 11. Maximum Content Width

Public-facing Nimpass pages should generally avoid stretching content across extremely wide screens.

Use centered content containers inspired by Luma-style composition.

Recommended conceptual ranges:

```text
General content:
1120–1280 px max

Reading/detail content:
720–880 px

Wide dashboard content:
1280–1440 px
```

Use whitespace outside the content container.

Do not fill every available pixel.

---

# 12. Whitespace

Whitespace is a fundamental design element.

Nimpass should feel spacious.

Prefer:

```text
content
       
       breathing room
       
next content
```

instead of:

```text
content
content
content
border
content
card
border
content
```

Spacing should provide hierarchy before borders are introduced.

---

# 13. Spacing System

Use a consistent spacing scale.

Recommended Tailwind-compatible conceptual scale:

```text
4 px
8 px
12 px
16 px
20 px
24 px
32 px
40 px
48 px
64 px
80 px
96 px
```

Prefer multiples of 4.

Common patterns:

```text
Icon ↔ text:
8px

Related elements:
8–12px

Form field groups:
16–24px

Card internal spacing:
20–24px

Section spacing:
48–80px

Major page sections:
64–96px
```

Avoid arbitrary values without a clear reason.

---

# 14. Density

Nimpass should generally use **low-to-medium information density**.

Customer interfaces should strongly favor low density.

Provider management interfaces may use medium density where necessary.

Never turn provider tools into a dense enterprise control panel.

---

# 15. Color Philosophy

Color should be restrained.

The interface should rely primarily on:

* neutral backgrounds,
* typography,
* whitespace,
* imagery,
* subtle accent color.

Avoid making every surface colorful.

Color should communicate:

* brand identity,
* action,
* status,
* emphasis.

Not decoration for its own sake.

---

# 16. Base Theme

The primary Nimpass visual theme should be light.

Recommended direction:

```text
Page background:
soft off-white / warm neutral

Primary surface:
white

Secondary surface:
very light neutral

Primary text:
near-black

Secondary text:
muted charcoal / gray

Borders:
very subtle neutral

Brand accent:
Nimpass-specific restrained accent
```

Do not default to pure:

```text
#FFFFFF everywhere
+
#000000 everywhere
```

Small tonal differences can create depth without heavy shadows.

---

# 17. Dark Mode

Dark mode is not a design priority for the competition MVP unless explicitly approved later.

Do not spend core implementation time building a second theme before the primary light theme is excellent.

The source-of-truth visual identity is the light theme.

---

# 18. Accent Color

Nimpass should eventually have one recognizable primary accent.

The accent must:

* work on light surfaces,
* remain elegant,
* avoid crypto/neon aesthetics,
* support accessible contrast,
* feel compatible with Luma-inspired visual restraint.

Use the accent sparingly for:

* primary actions,
* selected states,
* important highlights,
* subtle pass identity,
* focus indicators.

Do not paint every card using the accent.

---

# 19. Semantic Colors

Semantic colors should remain standard and understandable.

Conceptually:

```text
Success
→ green family

Warning
→ amber family

Error
→ red family

Information
→ neutral or restrained blue family
```

Use semantic color together with:

* icon,
* label,
* copy.

Never rely on color alone.

---

# 20. Avoid Crypto Visual Language

Do not use typical crypto design clichés.

Avoid:

* dark trading dashboards,
* neon purple gradients,
* neon green accents,
* glowing cards,
* holographic effects,
* token charts,
* candlestick charts,
* glassmorphism everywhere,
* blockchain network diagrams in normal UX,
* massive wallet addresses,
* token tickers,
* “DeFi” visual language,
* cyberpunk backgrounds.

Nimiq is infrastructure.

Nimpass is the product.

---

# 21. Typography Philosophy

Typography should carry much of the visual hierarchy.

Use:

* large confident headings,
* clean body copy,
* restrained font weights,
* generous line height,
* strong contrast between primary and secondary text.

Avoid excessive typography variations.

A strong Nimpass page should remain visually attractive even if most decorative components are removed.

---

# 22. Font Direction

Use a high-quality modern sans-serif that works well with the technical stack.

Prefer fonts compatible with modern web implementation and excellent readability.

The exact font may be determined during implementation, but the intended character is:

* contemporary,
* neutral,
* warm,
* highly legible,
* not overly geometric,
* not futuristic.

Do not use novelty or “crypto” fonts.

---

# 23. Typography Scale

Recommended conceptual hierarchy:

```text
Display
48–64 px
Large landing page statements

H1
36–48 px

H2
28–36 px

H3
22–28 px

Large body
18–20 px

Body
15–17 px

Small
13–14 px

Micro / metadata
12–13 px
```

Responsive typography should scale naturally.

Large headings should reduce appropriately on smaller screens.

---

# 24. Font Weight

Use restrained weight differences.

Typical:

```text
Regular
400

Medium
500

Semibold
600
```

Heavy `700–900` typography should be used rarely.

Loud bold text everywhere destroys the calm visual hierarchy.

---

# 25. Text Hierarchy

Example:

```text
PERSONAL TRAINING            ← metadata

10 Personal Training
Sessions                     ← primary heading

Alex Fitness                 ← supporting identity

Private one-to-one training  ← body

250 NIM                      ← important value
```

Different importance levels must be immediately understandable.

---

# 26. Borders

Borders should be subtle.

Avoid surrounding every element with visible borders.

Preferred:

```text
spacing
surface contrast
typography
```

before:

```text
border
border
border
```

Use borders when they genuinely define:

* inputs,
* cards requiring separation,
* tables,
* dialogs,
* interactive boundaries.

---

# 27. Border Radius

Nimpass should use a consistent moderate-to-generous radius system.

Conceptual scale:

```text
Small:
8 px

Standard:
12 px

Card:
16 px

Large surface:
20–24 px

Pill:
9999 px
```

Avoid:

* completely square interfaces,
* exaggerated bubble-like radius on everything.

---

# 28. Shadows

Use shadows sparingly.

Most hierarchy should come from:

* background difference,
* spacing,
* border,
* typography.

Recommended shadow character:

* soft,
* wide,
* low-opacity.

Avoid floating cards that look detached from the page.

---

# 29. Imagery

Like Luma, high-quality imagery can contribute significantly to page character.

Provider or service imagery may appear in:

* provider profiles,
* service cards,
* package detail pages,
* hero areas.

Prefer:

* authentic professional imagery,
* calm editorial compositions,
* strong cropping,
* consistent aspect ratios.

Avoid generic crypto illustrations.

---

# 30. Image Shape

Common image treatments may include:

```text
Square provider avatar

3:2 or 16:10 service image

Large rounded cover image

Compact card thumbnail
```

Use consistent aspect ratios within the same component type.

---

# 31. Navigation Philosophy

Navigation should be minimal and quiet.

The user should spend attention on content, not navigation chrome.

For the public/customer experience, a conceptual desktop navigation may be:

```text
Nimpass

Discover
My Passes
For Providers

                    Wallet
```

Do not overload navigation with every available feature.

---

# 32. Header

Desktop header characteristics:

* restrained height,
* ample horizontal spacing,
* subtle/no bottom border where possible,
* logo on left,
* small number of navigation items,
* compact wallet control,
* no large dashboard toolbar feel.

Possible structure:

```text
Nimpass    Discover    My Passes    For Providers

                                [ Wallet ]
```

---

# 33. Wallet Control

Wallet status should remain visually secondary.

Examples:

```text
[ Wallet ] Connect
```

or:

```text
[ Wallet ] Connected
```

or:

```text
[ Wallet ] NQ…81
```

Do not show:

* giant balances,
* full wallet address,
* network information,
* blockchain jargon,

unless the user explicitly asks for those details.

---

# 34. Mobile Navigation

Mobile navigation must adapt intentionally.

Potential patterns:

* compact top bar,
* bottom navigation,
* sheet-based menu.

Do not automatically duplicate the desktop header.

Primary destinations should remain limited.

---

# 35. Cards

Cards are useful but must not become the entire interface.

Nimpass must avoid:

```text
Card inside card
inside card
inside another card.
```

Use cards primarily for:

* packages,
* passes,
* provider summary,
* payment summary,
* meaningful grouped objects.

Do not card-wrap plain paragraphs unnecessarily.

---

# 36. Package Card

Package cards should be clean and highly scannable.

Example content hierarchy:

```text
[ Image / Provider Avatar ]

Personal Training

Alex Fitness

10 Sessions

250 NIM

[ View Package ]
```

Priority:

```text
1. Service / package
2. Provider
3. Number of sessions
4. Price
5. CTA
```

Do not display excessive metadata.

---

# 37. Package Card Hover

On desktop, hover states may use:

* tiny surface shift,
* subtle border change,
* subtle image scale,
* very restrained shadow change.

Avoid exaggerated floating animation.

Motion should feel polished, not playful.

---

# 38. Provider Profile

Provider pages should take strong inspiration from Luma organizer/calendar-style pages.

The page should establish:

```text
Who is this?

What do they offer?

Can I trust them?

What packages can I buy?
```

Conceptual desktop layout:

```text
        [ Provider Image ]

          Alex Fitness

        Personal Trainer

Helping people build strength and
healthier habits through private training.

          [ Share ]

------------------------------------

Available Packages

[ Package ] [ Package ] [ Package ]
```

Avoid social-network patterns.

No:

* followers,
* likes,
* feed,
* engagement counters,

unless explicitly introduced as a future product decision.

---

# 39. Discover Page

The Discover page should feel closer to Luma Discover than to Amazon.

This is important.

Nimpass should not feel like a huge marketplace.

Conceptual page:

```text
Discover

Services worth coming back to.

Buy prepaid sessions from independent
professionals and keep every visit in
one simple digital pass.

[ Search ]

All  Fitness  Tutoring  Languages  Coaching  Wellness

Popular Services

[ package ] [ package ] [ package ]

Explore Providers

[ provider ] [ provider ] [ provider ]
```

Keep the content curated.

---

# 40. Discovery Filters

Use simple filters.

Examples:

```text
All
Fitness
Tutoring
Languages
Coaching
Wellness
Music
```

Use:

* pills,
* tabs,
* compact selectors,

depending on context.

Avoid enormous filter sidebars unless discovery becomes significantly more complex.

---

# 41. Search

Search should feel light.

Example:

```text
[ Search services or providers... ]
```

Do not design a heavy marketplace search system before product requirements justify it.

---

# 42. Package Detail Page

This is one of the most important Nimpass pages.

It should take strong inspiration from Luma's content/detail page philosophy.

Desktop may use:

```text
┌────────────────────────────────┬────────────────────┐
│                                │                    │
│ Service image                  │ Purchase panel     │
│                                │                    │
├────────────────────────────────┤ 10 Sessions        │
│                                │                    │
│ Personal Training              │ 250 NIM            │
│                                │                    │
│ 10 Personal Training Sessions  │ [ Buy with NIM ]  │
│                                │                    │
│ Alex Fitness                   │                    │
│                                │                    │
│ Description                    │                    │
│                                │                    │
│ What you'll get                │                    │
└────────────────────────────────┴────────────────────┘
```

The purchase panel may become sticky where appropriate.

---

# 43. Package Detail Hierarchy

The user should understand within seconds:

```text
What is it?
Who provides it?
How many sessions?
How much does it cost?
What do I receive?
```

Example:

```text
Personal Training

10 Personal Training Sessions

Alex Fitness

10 private one-to-one training sessions.

10 sessions

250 NIM
```

Primary CTA:

```text
Buy with NIM
```

---

# 44. What You'll Get

A simple section may show:

```text
What you'll get

✓ 10 private training sessions
✓ Digital Nimpass
✓ Session history
✓ Secure ownership
```

Do not turn this into technical blockchain documentation.

---

# 45. Purchase Panel

The purchase panel should be visually distinct but calm.

Use:

* simple surface,
* modest radius,
* subtle border/shadow,
* clear price,
* obvious CTA.

Avoid crypto checkout aesthetics.

---

# 46. Payment Experience

Nimiq Pay interactions should feel like a natural extension of Nimpass.

Conceptually:

```text
10 Personal Training Sessions

Alex Fitness

10 sessions

250 NIM

[ Pay 250 NIM ]
```

Do not recreate wallet functionality unnecessarily.

---

# 47. Payment States

## Pending

```text
Confirming payment…
```

Use a restrained loader.

---

## Successful

```text
Payment successful

Your pass is ready.

[ View Pass ]
```

---

## Cancelled

```text
Payment cancelled

You were not charged.

[ Try Again ]
```

---

## Failed

```text
Payment couldn't be completed.

[ Try Again ]
```

Success and failure must never look visually ambiguous.

---

# 48. My Passes

`My Passes` should become one of Nimpass's most recognizable screens.

This is not an analytics dashboard.

It is a collection of objects owned by the customer.

Conceptual layout:

```text
My Passes

Active     Completed

┌─────────────────────────────┐
│ Personal Training           │
│ Alex Fitness                │
│                             │
│ 7 sessions remaining        │
│ 3 of 10 used                │
│                             │
│ [ View Pass ]               │
└─────────────────────────────┘
```

On desktop, passes may use a refined grid.

On mobile, stack vertically.

---

# 49. Pass Card

The pass card must prioritize:

```text
Service
Provider
Status
Remaining sessions
Progress
```

Example:

```text
Personal Training

Alex Fitness                  ACTIVE

7 sessions remaining

3 of 10 used

───────────────○○○
```

Avoid showing unnecessary transaction details.

---

# 50. Pass Detail — Signature Screen

The Pass Detail page is one of the most important screens in the entire product.

It should feel visually distinctive.

The user should feel:

> **This is my pass.**

A conceptual layout:

```text
Personal Training

Alex Fitness

ACTIVE


        7

 sessions remaining

     3 of 10 used

● ● ● ○ ○ ○ ○ ○ ○ ○


[ Use Session ]

View History
```

The exact progress visualization may differ.

The hierarchy must not.

---

# 51. Remaining Session Number

For active passes, remaining sessions should be among the largest typography on the screen.

Example:

```text
7
sessions remaining
```

This is more important than:

* wallet address,
* transaction ID,
* package identifier,
* blockchain metadata.

---

# 52. Session Progress

Progress should be understandable immediately.

Possible representations:

```text
3 of 10 used
```

plus:

```text
● ● ● ○ ○ ○ ○ ○ ○ ○
```

or an elegant progress bar.

Do not make progress visualization unnecessarily gamified.

---

# 53. Digital Pass Identity

The pass should feel like a digital object without copying Apple Wallet.

Potential ingredients:

* larger radius,
* subtle surface tone,
* provider identity,
* session balance,
* subtle brand accent,
* status,
* small service image or mark.

Avoid:

* metallic gradients,
* fake credit-card numbers,
* Apple Wallet imitation,
* NFT aesthetics.

---

# 54. Session Redemption

The primary CTA should use human language.

Preferred:

```text
Use Session
```

or:

```text
Redeem Session
```

Choose one canonical terminology in implementation and use it consistently.

Avoid:

```text
Burn Credit
Execute Redemption
Claim Token
Consume Entitlement
```

---

# 55. Redemption Surface

The redemption experience should remain simple regardless of mechanism.

Example:

```text
Use a Session

Personal Training

7 sessions available

Redeem one session?

After this:
6 sessions will remain.

[ Confirm Session ]
```

If QR is relevant, present it as an interaction method, not as the product itself.

---

# 56. QR / Code Redemption

Possible surface:

```text
Use a Session

Show this code to Alex Fitness.

[ QR ]

or

Code
812 483

Expires in 01:32
```

On desktop, a code may be especially useful.

On mobile, QR may be more convenient.

The underlying experience should remain consistent.

---

# 57. Redemption Success

After redemption:

```text
Session used

6 sessions remaining.

[ Done ]
```

A subtle transition from:

```text
7 → 6
```

may reinforce the state change.

Avoid celebration overload.

A small tasteful motion is enough.

---

# 58. Redemption Errors

Error states should remain calm.

Examples:

## Expired

```text
This code expired.

No session was used.

[ Generate New Code ]
```

## Already used

```text
This session code has already been used.
```

## Completed

```text
This pass has no sessions remaining.
```

## Network problem

```text
We couldn't confirm the session.

Please try again.
```

Do not show raw technical errors.

---

# 59. Session History

History exists for trust, not analytics.

Use a simple timeline or list.

Example:

```text
Session History

Sep 12

Session used
7 → 6 remaining

────────────────────

Sep 8

Session used
8 → 7 remaining

────────────────────

Sep 3

Session used
9 → 8 remaining
```

Avoid charts.

---

# 60. Completed Pass

Completed passes should remain beautiful but visually secondary.

Example:

```text
Personal Training

COMPLETED

10 of 10 sessions used

[ Buy Again ]

View History
```

A completed state should feel satisfying without looking like a game achievement.

---

# 61. Buy Again

`Buy Again` should be a natural continuation.

The CTA may be prominent on completed passes.

Conceptual lifecycle:

```text
Purchase
→ Use
→ Complete
→ Buy Again
```

This should visually feel intentional.

---

# 62. Provider Experience

The provider experience should share the same design DNA.

However, providers need more operational density.

Do not turn this into:

```text
generic enterprise admin template
```

The provider experience should feel like:

> **Luma host tools adapted for session-based service businesses.**

---

# 63. Provider Navigation

Desktop provider navigation may use a sidebar.

Example:

```text
Nimpass

Overview

Services
Packages
Passes

Activity

──────────

View Public Profile

Settings
```

Keep sidebar visually quiet.

Avoid multiple nested navigation levels unless necessary.

---

# 64. Provider Overview

The overview should provide operational information, not vanity analytics.

Example:

```text
Overview

Good morning, Alex.

Active Passes          24
Sessions This Month    83
Packages Sold          31
NIM Received        4,850

Recent Activity

...
```

Use limited summary cards.

Do not create twelve KPI cards simply because space exists.

---

# 65. Provider Dashboard Visual Rule

The provider dashboard must remain consistent with public Nimpass.

Do not suddenly switch into:

* blue enterprise dashboard,
* dense tables everywhere,
* dozens of charts,
* tiny typography,
* dark admin UI.

Keep:

* whitespace,
* typography,
* soft surfaces,
* restrained controls,
* Luma-inspired calmness.

---

# 66. Tables

Use tables when the content is genuinely tabular.

Examples:

* active passes,
* package management,
* redemption activity.

Tables should use:

* generous row height,
* subtle separators,
* minimal borders,
* clear headers,
* restrained actions.

Avoid spreadsheet density.

---

# 67. Responsive Tables

On smaller screens, tables may become:

* cards,
* stacked rows,
* horizontally scrollable layouts only when necessary.

Do not compress six columns into unreadable mobile content.

---

# 68. Services Screen

Provider service management may look like:

```text
Services                          [ Create Service ]

Personal Training
3 packages

Nutrition Coaching
2 packages
```

Do not overcomplicate the concept.

Services are containers for packages.

---

# 69. Packages Screen

Conceptual desktop:

```text
Packages                               [ Create Package ]

10 Personal Training Sessions
10 sessions · 250 NIM
Active

5 Personal Training Sessions
5 sessions · 140 NIM
Active
```

Use simple status and concise metadata.

---

# 70. Create Package Flow

Creating a package should feel as simple as Luma's creation forms.

Conceptual:

```text
Create Package

Service
[ Personal Training ]

Package name
[ 10 Personal Training Sessions ]

Number of sessions
[ 10 ]

Price
[ 250 ] NIM

Description
[                                      ]

Expiration
[ No expiration ▼ ]


[ Save Draft ]              [ Publish Package ]
```

Avoid unnecessarily splitting simple forms across many screens.

---

# 71. Forms

Forms should:

* use clear labels,
* provide generous vertical spacing,
* use helpful placeholder text sparingly,
* show errors inline,
* group related fields,
* keep optional fields visibly optional.

Do not use placeholders as the only label.

---

# 72. Input Dimensions

Inputs should feel comfortable.

Avoid tiny enterprise form controls.

Typical conceptual height:

```text
40–44 px compact

44–48 px standard
```

Primary customer-facing forms may use larger controls.

---

# 73. Buttons

Use a small set of button hierarchies.

## Primary

Used for the most important action.

Examples:

```text
Buy with NIM
Use Session
Publish Package
```

## Secondary

Supporting action.

Examples:

```text
View History
Preview
Save Draft
```

## Ghost

Quiet actions.

Examples:

```text
Cancel
Share
More
```

Avoid multiple primary buttons competing in the same visual area.

---

# 74. Button Shape

Buttons may use moderate rounded corners.

Do not make every button excessively pill-shaped.

Pills should be reserved primarily for:

* filters,
* status,
* compact controls.

---

# 75. Button Copy

Button labels should be short and explicit.

Preferred:

```text
Buy Pass
Buy with NIM
View Pass
Use Session
Create Package
Publish Package
Copy Link
```

Avoid:

```text
Continue to the next step
Proceed with Blockchain Payment
Execute
Submit Transaction
```

---

# 76. Icons

Use **Lucide Icons exclusively** for interface icons.

Possible icons include:

* Wallet,
* TicketCheck,
* QrCode,
* ScanLine,
* Check,
* CircleCheck,
* Clock,
* History,
* User,
* Users,
* Store,
* ArrowRight,
* ChevronRight,
* Plus,
* Minus,
* Search,
* SlidersHorizontal,
* Share2,
* Copy,
* ExternalLink,
* MoreHorizontal,
* Settings,
* ShieldCheck,
* Sparkles.

Icons support the content.

They do not replace labels where labels improve comprehension.

---

# 77. Icon Style

Maintain consistent:

* stroke width,
* size,
* alignment.

Typical sizes:

```text
16 px
18 px
20 px
24 px
```

Avoid giant decorative interface icons.

---

# 78. Badges

Badges may communicate:

```text
Active
Pending
Completed
Expired
Cancelled
```

Use quiet backgrounds and readable text.

Badges should not look like large buttons.

---

# 79. Status Hierarchy

Status must always be explicit.

Examples:

```text
ACTIVE

COMPLETED

PENDING
```

Never rely only on card color.

---

# 80. Empty States

Empty states should be quiet and helpful.

Customer:

```text
No passes yet

When you buy a session package,
your pass will appear here.

[ Discover ]
```

Provider:

```text
No packages yet

Create your first package
and start accepting NIM.

[ Create Package ]
```

Avoid giant illustrations unless they materially improve the experience.

---

# 81. Loading States

Use skeletons where content structure is predictable.

Use concise loading copy for critical processes.

Examples:

```text
Loading passes…

Preparing payment…

Confirming payment…

Creating your pass…

Using session…
```

Avoid blank screens.

---

# 82. Toasts

Toasts may support low-risk confirmation.

Examples:

```text
Link copied.

Package published.

Profile updated.
```

Critical state changes should not exist only in toasts.

Payment and redemption success must be visible in the main UI as well.

---

# 83. Dialogs

Use dialogs for focused actions.

Examples:

* confirmation,
* wallet/payment summary,
* destructive operations.

Avoid using dialogs for long content that deserves its own page.

---

# 84. Drawers and Sheets

On mobile, drawers/sheets may replace desktop:

* dialogs,
* dropdowns,
* side panels.

Do not automatically use sheets for every interaction.

---

# 85. Animation

Motion should be subtle.

Use it for:

* transitions,
* hover feedback,
* successful redemption,
* progress changes,
* dialog entry/exit.

Avoid:

* constant animated backgrounds,
* bouncing CTAs,
* crypto glow animation,
* excessive spring motion.

The interface should feel smooth, not animated.

---

# 86. Motion Duration

Keep most UI motion approximately:

```text
150–250 ms
```

Longer motion may be used only for intentional large transitions.

Respect reduced-motion preferences.

---

# 87. Accessibility

Design must support:

* keyboard navigation,
* visible focus states,
* semantic HTML,
* sufficient contrast,
* screen readers,
* meaningful button labels,
* readable type sizes,
* appropriate touch targets.

Color must not be the only status indicator.

---

# 88. Focus States

Keyboard focus should be visible but elegant.

Use a consistent focus ring based on the Nimpass accent.

Never remove focus outlines without a replacement.

---

# 89. Touch Targets

Mobile interactive targets should generally be at least approximately:

```text
44 × 44 px
```

Compact desktop controls may be smaller where appropriate.

---

# 90. UX Copy

Use human language.

Prefer:

```text
Buy Pass
```

not:

```text
Initiate Blockchain Transaction
```

Prefer:

```text
7 sessions remaining
```

not:

```text
Entitlement balance: 7
```

Prefer:

```text
Session used
```

not:

```text
Redemption transaction finalized
```

Prefer:

```text
Connect Wallet
```

not:

```text
Initialize cryptographic identity provider
```

---

# 91. Nimiq Visibility

Nimiq should be visible where relevant.

Examples:

```text
250 NIM

Pay with NIM

Continue with Nimiq Pay
```

This is enough.

Do not add Nimiq or blockchain terminology to unrelated product areas just to emphasize integration.

---

# 92. Wallet Details

Technical wallet details should live behind secondary disclosure.

Example:

```text
Payment details
```

may reveal:

* transaction information,
* wallet details,
* identifiers.

The main pass view should remain human-readable.

---

# 93. Component Architecture

The design should map realistically onto:

**React + TypeScript + Tailwind CSS + shadcn/ui + Lucide Icons**

Do not design interfaces requiring exotic UI frameworks.

Prefer shadcn-compatible patterns.

---

# 94. Preferred shadcn Components

Use components such as:

* Button,
* Card,
* Badge,
* Avatar,
* Input,
* Textarea,
* Select,
* Dropdown Menu,
* Dialog,
* Drawer,
* Sheet,
* Tabs,
* Accordion,
* Separator,
* Skeleton,
* Tooltip,
* Alert,
* Alert Dialog,
* Progress,
* Breadcrumb,
* Command,
* Popover,
* Toast / Sonner.

Use Calendar only where genuinely necessary.

---

# 95. Do Not Overuse Components

A shadcn component existing does not mean it needs to be used.

Avoid component soup.

A simple:

```text
heading
paragraph
button
```

is often preferable to:

```text
Card
CardHeader
CardTitle
CardDescription
Separator
CardContent
CardFooter
```

for every piece of content.

This principle is especially important for achieving the Luma-like visual simplicity.

---

# 96. Reusable Components

Core reusable Nimpass UI should include:

```text
AppHeader
PublicNavigation
ProviderSidebar

ProviderAvatar
ProviderCard

PackageCard
PackagePrice
PackageSummary

PassCard
PassDetail
PassStatusBadge
SessionProgress

WalletButton

PrimaryCTA
SecondaryCTA

FilterChip

HistoryItem
HistoryTimeline

EmptyState
ErrorState
LoadingState

PaymentState

RedemptionDialog
RedemptionChallenge
QRRedemptionCard

FormField
```

Do not create unrelated one-off versions of the same object on every page.

---

# 97. Design Tokens

The implementation should centralize:

* colors,
* typography,
* spacing,
* radius,
* shadows,
* transition durations,
* container widths.

Do not scatter arbitrary styling values across components.

Tailwind theme variables and CSS variables should be used where appropriate.

---

# 98. Page Structure

Most public pages should follow a restrained hierarchy:

```text
Navigation

Page Intro / Hero

Primary Content

Supporting Content

Footer
```

Avoid endless nested sections.

---

# 99. Hero Areas

Heroes should be concise.

Luma-style influence means large typography does more work than excessive illustrations.

Example:

```text
Services you can
use over time.

Buy prepaid sessions from professionals
you trust and keep every visit in one pass.

[ Discover Services ]
```

Do not create giant corporate SaaS heroes with:

* six badges,
* dashboard mockup,
* testimonial strip,
* trusted-by logos,
* ten CTAs.

---

# 100. Public Home Page

The Nimpass landing/discovery experience may use:

```text
Header

Hero

Featured / Popular Services

Categories

Featured Providers

Simple explanation of how Nimpass works

Footer
```

Keep it concise.

---

# 101. How It Works

If explanation is needed:

```text
1. Choose a package

2. Pay with NIM

3. Get your pass

4. Use sessions over time
```

Four steps are enough.

Do not explain blockchain implementation.

---

# 102. Footer

Footer should remain light.

Potential content:

```text
Nimpass

Discover
For Providers
About

Terms
Privacy

Built for Nimiq
```

Do not create a massive enterprise sitemap unless necessary.

---

# 103. Visual Consistency Between Customer and Provider

Customer and provider interfaces belong to the same product.

Shared:

* typography,
* colors,
* radius,
* buttons,
* icons,
* spacing,
* surface language.

Provider interfaces may increase density.

They should never look like a separate template purchased from another UI library.

---

# 104. Public vs Operational Surfaces

Public/customer pages should feel closest to Luma.

Provider operational pages may become slightly more functional and structured.

Conceptually:

```text
Public / Customer
→ editorial
→ visual
→ spacious

Provider
→ operational
→ structured
→ still spacious
```

Both remain recognizably Nimpass.

---

# 105. Design Priorities

When making a design tradeoff, prioritize:

```text
1. Clarity
2. Simplicity
3. Trust
4. Product hierarchy
5. Luma-like visual polish
6. Responsive behavior
7. Consistency
8. Decoration
```

Decoration comes last.

---

# 106. Visual Reduction Rule

Before adding another visual element, ask:

> Can spacing, typography, or alignment solve this instead?

Before adding a border:

> Is the boundary actually unclear?

Before adding a card:

> Is this really a distinct object?

Before adding an icon:

> Does it improve comprehension?

Before adding color:

> Does it communicate meaning?

This reduction mindset is central to achieving the intended design.

---

# 107. Anti-Patterns

Do not build Nimpass using:

* giant dashboard KPI grids,
* generic admin templates,
* gradients everywhere,
* excessive rounded cards,
* glassmorphism,
* excessive shadows,
* strong border grids,
* crypto charts,
* huge wallet balances,
* oversized icons,
* noisy sidebars,
* multiple nested toolbars,
* random illustration packs,
* excessive badges,
* unnecessary tabs,
* unnecessary modal flows.

---

# 108. Luma Similarity Test

When reviewing a public-facing Nimpass screen, ask:

```text
Would this feel visually at home
next to a modern Luma page?

Is there enough whitespace?

Is typography doing most of the hierarchy work?

Are we using too many cards?

Are there too many borders?

Is navigation quiet?

Is the primary action obvious?

Does the page feel calm?

Does imagery feel intentional?

Is information easy to scan?

Have we added unnecessary Web3 visuals?
```

If several answers are negative, simplify the screen.

---

# 109. Nimpass Identity Test

Similarity to Luma must not erase Nimpass's product identity.

Ask:

```text
Can the user immediately see
the number of sessions?

Can the user understand
the provider?

Can the user understand
the package?

Can the user see
what remains?

Does the pass feel owned?

Is NIM purchasing obvious
without looking like a crypto exchange?
```

If not, the design has become too generic.

---

# 110. Page-Specific Luma Influence

Use Luma most strongly for:

```text
Home / Discover
Provider profile
Package detail
Public package sharing
Creation forms
Navigation
General typography
Whitespace
Image treatment
```

Use more Nimpass-specific design for:

```text
My Passes
Pass Detail
Session Progress
Redemption
Session History
Provider pass management
```

This allows the product to be strongly Luma-inspired without becoming a visual clone.

---

# 111. Creation Experience

Provider creation forms should feel especially close to Luma's creation simplicity.

Avoid wizard fatigue.

If the provider can reasonably create a package on one page, prefer one calm page.

Example:

```text
Create Package

Service
Personal Training

Package Name
10 Personal Training Sessions

Sessions
10

Price
250 NIM

Description
...

[ Publish Package ]
```

Only introduce multiple steps if complexity genuinely requires them.

---

# 112. Desktop Design Requirements

Desktop must receive intentional designs for:

* Discover,
* Provider Profile,
* Package Detail,
* My Passes,
* Pass Detail,
* History,
* Provider Overview,
* Services,
* Packages,
* Passes,
* Create Package.

Do not generate mobile layouts and merely scale them up.

---

# 113. Mobile Design Requirements

Mobile adaptations must intentionally consider:

* compact navigation,
* vertical stacking,
* sticky purchase CTA,
* touch targets,
* wallet interactions,
* QR display,
* session count prominence,
* bottom sheets,
* responsive tables.

Do not remove important product capability simply because the screen is smaller.

---

# 114. Package Detail Responsive Example

Desktop:

```text
Main Content               Purchase Panel

Image                      10 Sessions
Title                      250 NIM
Provider                   
Description                Buy with NIM
What You'll Get
```

Mobile:

```text
Image

Title

Provider

10 Sessions
250 NIM

Description

What You'll Get


[ Buy with NIM ]
```

Primary content remains the same.

Composition changes.

---

# 115. Pass Detail Responsive Example

Desktop:

```text
Pass Identity             Details

7 Sessions Remaining      Purchase date
Progress                  Package
                           Provider

[ Use Session ]

History
```

Mobile:

```text
Pass Identity

7
sessions remaining

Progress

[ Use Session ]

Details

History
```

---

# 116. Provider Responsive Example

Desktop:

```text
Sidebar

Overview

Active Passes     Recent Activity
Packages          NIM Received

Pass Table
```

Mobile:

```text
Header

Overview

Active Passes
Packages
NIM Received

Recent Activity

Pass Cards
```

---

# 117. Visual Quality Bar

Nimpass must not look like:

* a hackathon prototype,
* a CRUD admin panel,
* a starter template with replaced text,
* a generic shadcn demo,
* a Web3 boilerplate.

It should look like a finished consumer product.

The quality target is deliberately high.

---

# 118. shadcn Is an Implementation Layer, Not the Visual Identity

Using shadcn does not mean Nimpass should look like the default shadcn examples.

Components should be styled consistently with this design system.

Do not leave:

* default spacing,
* default container composition,
* generic dashboard layouts,

simply because they come from a component example.

Nimpass must have its own composition.

---

# 119. Tailwind Rule

Tailwind should implement the design tokens.

Avoid arbitrary classes such as:

```text
mt-[37px]
rounded-[19px]
text-[#343434]
```

unless genuinely necessary.

Prefer semantic design tokens and consistent scales.

---

# 120. Interaction Feedback

Every interaction should feel responsive.

Buttons:

* hover,
* active,
* disabled,
* loading.

Cards:

* hover where clickable.

Forms:

* focus,
* invalid,
* disabled.

Critical state changes:

* visible confirmation.

Do not rely exclusively on toasts.

---

# 121. Disabled States

Disabled actions should remain readable.

Do not reduce opacity so aggressively that labels become inaccessible.

Where useful, explain why an action is unavailable.

Example:

```text
Use Session

Unavailable because this pass is completed.
```

---

# 122. Trust Design

Nimpass handles money and purchased service value.

Trust must therefore be visible in the design.

Use:

* explicit prices,
* explicit session counts,
* clear payment states,
* visible pass ownership context,
* history,
* clear status labels,
* predictable interactions.

Avoid:

* hidden fees,
* unclear button outcomes,
* ambiguous progress,
* disappearing history.

---

# 123. Financial Clarity

Price should always pair with currency.

Correct:

```text
250 NIM
```

Avoid:

```text
250
```

when currency is unclear.

---

# 124. Session Clarity

Similarly:

Correct:

```text
7 sessions remaining
```

Avoid:

```text
Balance: 7
```

The service unit must remain human-readable.

---

# 125. Provider Trust

Provider identity should be visible during:

* discovery,
* package detail,
* purchase,
* pass detail.

Users should not wonder who will deliver the purchased service.

---

# 126. Wallet Trust

Wallet interaction should be explicit when needed.

Example:

```text
Continue with Nimiq Pay
```

However, normal navigation and discovery should not constantly ask users to reconnect or think about their wallet.

---

# 127. Figma / Design Implementation Guidance

When creating design files:

* use Auto Layout,
* define reusable components,
* use component variants,
* define spacing tokens,
* define color styles,
* define typography styles,
* avoid detached one-off objects.

Components should map realistically onto implementation.

---

# 128. Minimum Component Set

The design system should support at minimum:

```text
Navigation
Sidebar
Mobile Navigation

Button variants
Input variants
Select
Textarea

Avatar

Provider Card
Package Card
Pass Card

Status Badge

Session Progress

Wallet Button

Payment State

Redemption Challenge
QR Card
Code Card

History Item

Empty State
Error State
Skeleton

Dialog
Sheet

Toast
```

---

# 129. Main Screens Required

A complete Nimpass design should eventually include:

## Public / Customer

```text
Home / Discover

Provider Profile

Package Detail

Payment

Payment Success
Payment Cancelled
Payment Failed

My Passes

Pass Detail

Redeem Session

Redemption Success

Session History

Completed Pass
```

## Provider

```text
Provider Overview

Provider Public Profile

Services

Create Service

Packages

Create Package

Package Detail / Management

Passes

Pass Detail

Validate Session

Recent Activity
```

---

# 130. Important States Required

Do not design only happy paths.

Include:

```text
Loading

Empty

Success

Error

Disabled

Pending

Cancelled

Expired

Completed

Unauthorized
```

where applicable.

---

# 131. Design Review Checklist

Before approving a screen, check:

```text
[ ] Does it look like Nimpass?

[ ] Does it feel strongly Luma-inspired?

[ ] Is the content hierarchy obvious?

[ ] Is there enough whitespace?

[ ] Is typography doing enough work?

[ ] Are we overusing cards?

[ ] Are we overusing borders?

[ ] Is the primary CTA obvious?

[ ] Is Web3 complexity hidden appropriately?

[ ] Does the screen work on desktop?

[ ] Does it adapt intentionally to mobile?

[ ] Are important states represented?

[ ] Is implementation realistic with shadcn?

[ ] Are Lucide icons used consistently?

[ ] Is accessibility considered?

[ ] Can anything unnecessary be removed?
```

---

# 132. AI Coding Agent Design Rules

AI coding agents working on Nimpass must follow these rules.

Before implementing a page:

1. Read `01-PRODUCT.md`.
2. Read `02-USER-FLOWS.md`.
3. Read this document.
4. Understand whether the screen is customer-facing or provider-facing.
5. Determine desktop composition first.
6. Determine responsive behavior.
7. Reuse existing components.
8. Do not invent a new visual style.
9. Do not introduce another UI library.
10. Do not introduce another icon library.

---

# 133. AI Agent — Luma Rule

When an AI agent has multiple valid visual approaches:

> Prefer the one that most closely follows Luma's simplicity and visual restraint.

This includes choosing:

```text
less UI chrome
over
more UI chrome

more whitespace
over
crowded content

strong typography
over
decorative widgets

simple layouts
over
complex dashboard structures

clear primary actions
over
many competing actions
```

---

# 134. AI Agent — Do Not Improvise Crypto UI

An AI agent must not introduce:

* wallet balance dashboard,
* portfolio screen,
* blockchain explorer styling,
* crypto gradients,
* token badges,
* chain selectors,
* gas UI,

unless explicitly required by the product flow.

Nimiq integration must remain purposeful.

---

# 135. AI Agent — Do Not Improvise Marketplace Complexity

An AI agent must not automatically introduce:

* huge category trees,
* recommendation algorithms,
* infinite feeds,
* seller ratings,
* complex reviews,
* shopping carts,
* wishlists,

simply because Nimpass contains service discovery.

The marketplace layer should remain focused.

---

# 136. AI Agent — Do Not Improvise SaaS Dashboard Complexity

An AI agent must not automatically create:

```text
MRR
ARR
conversion funnels
giant analytics charts
growth graphs
funnels
customer cohorts
```

The provider overview exists to help providers operate Nimpass.

Not to imitate enterprise SaaS software.

---

# 137. Design Source Hierarchy

When making a design decision, use this hierarchy:

```text
1. Nimpass product requirements
2. Nimpass user flows
3. This Design System
4. Luma visual / UX reference
5. shadcn implementation patterns
6. Generic UI conventions
```

Luma defines inspiration.

Nimpass defines behavior.

---

# 138. Conflict Rule

If a Luma-inspired pattern conflicts with Nimpass's actual product requirements:

> Nimpass requirements win.

Do not sacrifice:

* remaining-session clarity,
* secure redemption,
* payment clarity,
* pass state,
* provider operation,

merely to make a page resemble Luma more closely.

---

# 139. Similarity Goal

Within those constraints, Nimpass should pursue a **strong visual resemblance in philosophy** to Luma.

This means the final product should make observers naturally say:

> “This has a Luma-like level of simplicity and polish.”

That is intentional.

---

# 140. Final Experience Goal

When someone first opens Nimpass, the product should communicate:

```text
Find a service.

Choose a package.

Pay with NIM.

Receive your pass.

Use your sessions over time.

Always know what remains.
```

Nothing should feel more complicated than necessary.

---

# 141. Final Visual Goal

The final product should feel like:

> **Luma-quality web design applied to prepaid recurring services, with Nimiq powering the transaction and ownership layer quietly in the background.**

---

# 142. Final Platform Rule

Nimpass is:

```text
WEB-FIRST
RESPONSIVE
DESKTOP-FIRST-CLASS
LAPTOP-FIRST-CLASS
MOBILE-FRIENDLY
NIMIQ-PAY-COMPATIBLE
```

Nimpass is not:

```text
MOBILE-ONLY
PHONE-FIRST
GENERIC SAAS
GENERIC MARKETPLACE
GENERIC WEB3
CRYPTO DASHBOARD
```

---

# 143. Final Design Rule

When in doubt:

```text
Simplify.

Remove.

Create more breathing room.

Strengthen typography.

Reduce borders.

Reduce cards.

Clarify the primary action.

Keep Nimiq in the background.

Look at Luma again.
```

The intended result is not a visually busy product.

The intended result is a product that feels **effortless**.

---

# Source-of-Truth Rule

This document defines the visual and interaction identity of Nimpass.

Generated UI, implementation shortcuts, AI suggestions, templates, and component-library defaults must not silently redefine this design direction.

If an implementation conflicts with this document:

1. identify the conflict,
2. determine whether the implementation or design rule is wrong,
3. explicitly update this document if a new design decision is approved,
4. only then modify the implementation.

The project must not gradually drift from:

```text
Luma-inspired
web-first
minimal
premium
content-first
service-pass experience
```

into:

```text
generic shadcn dashboard
```

or:

```text
generic crypto application
```

or:

```text
mobile-only Mini App
```

simply because those patterns are easier to generate.

---

# Relationship to Other Documentation

```text
01-PRODUCT.md
→ What Nimpass is

02-USER-FLOWS.md
→ How users move through Nimpass

03-DESIGN-SYSTEM.md
→ How Nimpass looks, feels and adapts

04-NIMIQ-MINI-APPS.md
→ How the Nimiq Mini App environment works

05-NIMIQ-PAY-INTEGRATION.md
→ Wallet and payment integration

06-COMPETITION.md
→ Competition requirements

07-SCORING-STRATEGY.md
→ Competition score optimization

08-ARCHITECTURE.md
→ Technical architecture

09-SECURITY.md
→ Security model

10-SUBMISSION-CHECKLIST.md
→ Final readiness
```

No downstream document should casually redefine the visual identity established here.
