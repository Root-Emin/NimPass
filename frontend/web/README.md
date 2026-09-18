# Nimpass web

React + Vite frontend. Web-first and Nimiq Pay Mini App-compatible: the same
build meets a wallet through two official Nimiq surfaces, behind one
`WalletTransport` interface (`src/lib/nimiq/transport.ts`).

| Runtime | Wallet surface |
| --- | --- |
| Inside the Nimiq Pay WebView | the injected Nimiq provider, via `@nimiq/mini-app-sdk`'s `init()` |
| An ordinary browser | the Nimiq Hub, via `@nimiq/hub-api` |

The Hub is the browser fallback only. Inside Nimiq Pay the injected provider is
used and the Hub is never loaded.

## Commands

```sh
npm run dev         # Vite dev server, LAN-exposed for a phone
npm run typecheck   # tsc -b --noEmit
npm run lint        # oxlint
npm run build       # tsc -b && vite build
npm test            # build, then vitest run
```

`npm test` builds first on purpose: `src/dev/production-isolation.test.ts`
inspects the built bundle rather than trusting that the development fixture
layer tree-shakes.

## Environment

Two variables are mandatory and are validated against each other at build time
by `config/deployment.ts`, which `vite.config.ts` calls before it builds
anything:

| | Development | Production |
| --- | --- | --- |
| `VITE_APP_ENV` | `development` (or `test`) | `production` |
| `VITE_NIMIQ_NETWORK` | `TESTNET` | `MAINNET` |
| Template | `.env.example` | `.env.production.example` |

`production` requires `MAINNET` and `development`/`test` require `TESTNET`. Any
other pairing — including an unset or lower-case value — fails the build rather
than shipping.

**What this setting is and is not.** It states which Nimpass deployment a bundle
belongs to. It is not, and can never be, evidence of which chain a transaction
belongs to: Nimiq Pay chooses its own network, and its hidden developer menu
(long-press Settings for ten seconds) can force Mainnet or Testnet regardless of
the app. The backend re-derives every transaction's network from the chain
itself and refuses a cross-network payment outright. On page load the frontend
also reads `GET /api/v1/public/config` and refuses wallet-sensitive operations
when the API reports a different network or environment, so a Mainnet bundle
pointed at a Testnet API says so instead of quietly misbehaving.

No secret belongs in any `VITE_` variable: everything so prefixed is inlined
into the public bundle. The frontend never talks to a Nimiq node; the RPC
endpoint is backend configuration.

## Production deployment

`vercel.json` carries the production build configuration and the routing:

- `build.env` pins `VITE_APP_ENV=production`, `VITE_NIMIQ_NETWORK=MAINNET`,
  `VITE_DEV_FIXTURES=0` and `VITE_API_BASE_URL=/`.
- `/api/*` is rewritten to the backend origin, so the API is same-origin from
  the browser's point of view. That matters inside the Nimiq Pay WebView, where
  a cross-origin API host makes the session a cross-origin cookie the WebView is
  free to drop.
- Everything else falls through to `index.html` for React Router.

**The backend behind that rewrite must be the Mainnet backend.** The two halves
of a deployment are checked against each other at runtime, so a Mainnet frontend
in front of a Testnet API will refuse wallet operations with a network-mismatch
message rather than create a purchase. See
[`backend/README.md`](../../backend/README.md) → *Mainnet production
deployment*.

## Local Testnet development

From the repository root, `./start.sh` is the zero-configuration path: it writes
the ignored Testnet env files, finds the LAN address, starts PostgreSQL and the
backend, and prints the Custom URL to paste into Nimiq Pay. It refuses
`APP_ENV=production` and any network but `TESTNET`.

The device procedure and its evidence log live in
[`NIMIQ-PAY-TESTING.md`](NIMIQ-PAY-TESTING.md).
