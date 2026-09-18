import type { PaymentRequest } from '@/types/domain'

/**
 * How to get Nimiq Pay onto the network this deployment settles on.
 *
 * The Mini Apps API exposes no network switch and no way to read the selected
 * one, so this is the only thing Nimpass can do about it: say which network is
 * needed and how the wallet chooses it. Inventing a provider method to check it
 * is not an option — none is documented.
 *
 * The two sentences differ because the situations do. A production Nimiq Pay
 * build already defaults to Mainnet, so the Mainnet copy confirms rather than
 * instructs, and mentions the dev menu only as the thing that could have moved
 * it. Testnet always requires the deliberate switch.
 * Ref: https://nimiq.dev/mini-apps/development/load-local-mini-app
 *
 * Making this depend on `request.network` — the network the *backend* stamped
 * on this purchase intent — rather than on the build is what keeps a Mainnet
 * customer from ever being told to select Testnet.
 */
export function networkHint(network: PaymentRequest['network']): string {
  return network === 'MAINNET'
    ? 'A normal Nimiq Pay install is already on Mainnet; only its hidden developer menu changes that.'
    : 'For Testnet, long-press Settings for 10 seconds and choose Testnet.'
}
