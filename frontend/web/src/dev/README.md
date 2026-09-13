# Development fixtures — NOT production data

Everything in this folder exists so the public marketplace surfaces can be
designed and reviewed while the Nimpass backend is still being built.

Rules this folder obeys, from `docs/08-ARCHITECTURE.md` §11 and the milestone
brief:

1. **Off by default.** Fixtures are served only when the app is running in Vite
   dev mode *and* `VITE_DEV_FIXTURES=1` is set. Both conditions are checked, and
   the `import.meta.env.DEV` guard means this code is dropped from production
   builds entirely.
2. **Catalogue only.** Fixtures answer read-only public catalogue requests:
   providers, services and packages. Nothing else.
3. **No authoritative business results.** Purchases, passes, payments,
   redemptions and every provider mutation are explicitly refused, so those
   flows keep showing their real unavailable/error states instead of a
   fabricated success.
4. **Visible.** While fixtures are on, the app shows a banner saying so.

If you are looking at Nimpass and see the banner, none of the catalogue content
on screen came from a backend.
